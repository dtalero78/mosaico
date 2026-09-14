import 'server-only';
import { query } from '@/lib/postgres';
import type { TipoSalidaCupo } from '@/lib/tipo-salida-cupo';

/**
 * Soltar el asiento de un beneficiario en su salón — UNA sola definición.
 *
 * Hay DOS caminos que sueltan el cupo y tienen que dejar lo mismo: el botón
 * "Liberar cupo" de la ficha y la INACTIVACIÓN del alumno. Estaban divergidos:
 * el primero borraba el curso y las clases futuras, el segundo sólo marcaba
 * `estadoInactivo` — el asiento quedaba suelto por la regla de `lib/cupo` pero
 * el alumno conservaba su curso y sus 394 clases seguían contando en el
 * calendario de su guía. Dos formas de soltar el cupo con dos resultados no son
 * una regla, son dos; por eso vive aquí y no copiada en cada llamador.
 *
 * Qué hace, siempre lo mismo:
 *  1. Borra sus clases FUTURAS y descuenta el contador de inscritos del evento.
 *     Las PASADAS se conservan: son su historia, no su asiento.
 *  2. Suelta el asiento (`cupoLiberado`) y borra campaña/curso/horario/salón, en
 *     PEOPLE y en ACADEMICA. Así desaparece de las listas del salón por el propio
 *     dato y no sólo por la regla de cupo.
 *  3. Escribe la entrada en `cupoHistory` con DE DÓNDE salió — el único sitio
 *     donde ese dato sobrevive al borrado de las columnas.
 *
 * El append lo hace PostgreSQL (`jsonb || jsonb`) dentro de la misma sentencia:
 * leer-modificar-escribir desde la app perdería una de dos escrituras simultáneas.
 */

/** Cómo sale el alumno del salón. La lista vive en `lib/tipo-salida-cupo`
 *  (cliente + servidor); aquí sólo se reexporta para no romper a quien ya la
 *  importaba de este servicio. */
export type { TipoSalidaCupo };

export type OrigenCupo = 'INACTIVACION' | 'MANUAL' | 'ASIGNACION' | 'REACTIVACION';

export interface CursoDelAlumno {
  campaign: string | null;
  tipoCurso: string | null;
  horarioCurso: string | null;
  salon: string | null;
}

export interface MovimientoCupoOpts {
  origen: OrigenCupo;
  tipoSalida?: TipoSalidaCupo | null;
  motivo?: string | null;
  realizadoPor: string;
  realizadoPorNombre?: string | null;
}

export interface ResultadoLiberacion {
  cursoBorrado: CursoDelAlumno;
  clasesSoltadas: number;
}

/** Construye la entrada de bitácora. Se guarda tal cual en `cupoHistory`. */
function entrada(
  accion: 'LIBERADO' | 'ASIGNADO',
  curso: CursoDelAlumno,
  opts: MovimientoCupoOpts,
  clasesSoltadas: number
) {
  return {
    fecha: new Date().toISOString(),
    accion,
    origen: opts.origen,
    tipoSalida: opts.tipoSalida ?? null,
    campaign: curso.campaign ?? null,
    tipoCurso: curso.tipoCurso ?? null,
    horarioCurso: curso.horarioCurso ?? null,
    salon: curso.salon ?? null,
    motivo: opts.motivo ?? null,
    realizadoPor: opts.realizadoPor,
    realizadoPorNombre: opts.realizadoPorNombre ?? null,
    clasesSoltadas,
  };
}

/**
 * Suelta el asiento del beneficiario `personId`.
 *
 * Devuelve `null` si la persona no existe o es TITULAR — el cupo es del alumno,
 * el titular no ocupa ninguno. Es idempotente: sobre alguien que ya lo tenía
 * suelto vuelve a registrar el movimiento con el curso que le quede (vacío), sin
 * romper nada.
 */
export async function liberarCupoBeneficiario(
  personId: string,
  opts: MovimientoCupoOpts
): Promise<ResultadoLiberacion | null> {
  const persona = await query<any>(
    `SELECT "_id","tipoUsuario","numeroId","campaign","tipoCurso","horarioCurso","salon"
       FROM "PEOPLE" WHERE "_id" = $1`,
    [personId]
  ).then(r => r.rows[0]);
  if (!persona) return null;
  if (String(persona.tipoUsuario || '').toUpperCase() === 'TITULAR') return null;

  const cursoBorrado: CursoDelAlumno = {
    campaign: persona.campaign ?? null,
    tipoCurso: persona.tipoCurso ?? null,
    horarioCurso: persona.horarioCurso ?? null,
    salon: persona.salon ?? null,
  };

  // Sus fichas académicas: los agendamientos cuelgan del ACADEMICA._id, y un
  // beneficiario puede tener más de una fila si su documento está duplicado.
  const academicaIds = (await query<{ _id: string }>(
    `SELECT "_id" FROM "ACADEMICA" WHERE "numeroId" = $1`, [persona.numeroId]
  )).rows.map(r => r._id);

  let clasesSoltadas = 0;
  if (academicaIds.length) {
    const soltadas = await query<{ evid: string }>(
      `DELETE FROM "ACADEMICA_BOOKINGS" b
        USING "CALENDARIO" c
        WHERE (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
          AND c."dia" >= NOW()
          AND (b."idEstudiante" = ANY($1::text[]) OR b."studentId" = ANY($1::text[]))
        RETURNING c."_id" AS evid`,
      [academicaIds]
    );
    clasesSoltadas = soltadas.rowCount ?? 0;
    const evs = Array.from(new Set((soltadas.rows || []).map(r => r.evid).filter(Boolean)));
    if (evs.length) {
      await query(
        `UPDATE "CALENDARIO" SET "inscritos" = GREATEST(0, COALESCE("inscritos",0) - 1), "_updatedDate" = NOW()
          WHERE "_id" = ANY($1::text[])`, [evs]);
    }
  }

  await query(
    `UPDATE "PEOPLE"
        SET "cupoLiberado" = true, "cupoLiberadoPor" = $1, "cupoLiberadoEn" = NOW(),
            "cupoReservadoHasta" = NULL,
            "campaign" = NULL, "tipoCurso" = NULL, "horarioCurso" = NULL, "salon" = NULL,
            "cupoHistory" = COALESCE("cupoHistory", '[]'::jsonb) || $3::jsonb,
            "_updatedDate" = NOW()
      WHERE "_id" = $2`,
    [opts.realizadoPor, personId, JSON.stringify([entrada('LIBERADO', cursoBorrado, opts, clasesSoltadas)])]
  );

  // ACADEMICA sigue al beneficiario (si ya tiene ficha).
  await query(
    `UPDATE "ACADEMICA" SET "campaign" = NULL, "salon" = NULL, "_updatedDate" = NOW()
      WHERE "numeroId" = $1`,
    [persona.numeroId]
  ).catch(() => { /* best-effort: puede no tener ficha aún */ });

  return { cursoBorrado, clasesSoltadas };
}

/**
 * Registra en la bitácora que el alumno VOLVIÓ a tomar un asiento. No mueve
 * datos — de eso se encargan "Asignar cupo" y la reactivación, cada uno con su
 * propia validación de cupo; esto sólo deja la línea en el historial para que la
 * salida y el regreso se lean seguidos.
 */
export async function registrarCupoAsignado(
  personId: string,
  destino: CursoDelAlumno,
  opts: MovimientoCupoOpts
): Promise<void> {
  await query(
    `UPDATE "PEOPLE"
        SET "cupoHistory" = COALESCE("cupoHistory", '[]'::jsonb) || $2::jsonb
      WHERE "_id" = $1`,
    [personId, JSON.stringify([entrada('ASIGNADO', destino, opts, 0)])]
  ).catch(() => { /* best-effort: la bitácora nunca debe tumbar la asignación */ });
}
