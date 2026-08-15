import 'server-only';
import { query, queryOne, transaction } from '@/lib/postgres';
import { ids } from '@/lib/id-generator';
import { ValidationError, NotFoundError, ConflictError } from '@/lib/errors';

/**
 * Casos de Atención.
 *
 * Un **reporte** es texto libre que el guía escribe sobre una situación del
 * alumno, siempre desde el panel del guía dentro de un evento. Un **caso**
 * agrupa los reportes de un mismo tema y lleva la gestión: intentos de contacto
 * con el apoderado, acuerdo alcanzado y seguimiento de finanzas.
 *
 * Reglas que este servicio hace cumplir:
 *  R1/R4  el reporte sólo se crea aquí y es inmutable — no hay update ni delete
 *  R2     si el alumno ya tiene un caso abierto, el guía DEBE elegir destino
 *  R3     un alumno puede tener varios casos abiertos, uno por tema
 *  R5     cambiar de estado es la acción de cierre, y exige acuerdo + fecha
 *  R6     todo cambio de estado queda en el historial
 *  R7     el reporte nace sin leer
 *  R8     los intentos de contacto sólo se agregan, no se editan
 */

export const ESTADO_ABIERTO = 'EN_GESTION' as const;

export type EstadoCaso =
  | 'EN_GESTION' | 'RESUELTO' | 'PROCESO_DE_CIERRE' | 'PROPUESTA_DE_CAMBIO'
  | 'CIERRA_PROGRAMA' | 'REMITIDO_A_ACADEMICA' | 'PROGRAMA_CONGELADO'
  | 'PRE_JURIDICO' | 'SIN_CONTACTO';

export type TemaCaso = 'ASISTENCIA' | 'CONDUCTA' | 'DESEMPENO' | 'SALUD' | 'PAGO' | 'OTRO';
export type CanalContacto = 'LLAMADA' | 'WHATSAPP' | 'EMAIL';
export type ResultadoContacto = 'CONTESTO' | 'NO_CONTESTO' | 'RESPONDIO' | 'SIN_RESPUESTA' | 'PENDIENTE';

export const ESTADOS: EstadoCaso[] = ['EN_GESTION', 'RESUELTO', 'PROCESO_DE_CIERRE',
  'PROPUESTA_DE_CAMBIO', 'CIERRA_PROGRAMA', 'REMITIDO_A_ACADEMICA', 'PROGRAMA_CONGELADO',
  'PRE_JURIDICO', 'SIN_CONTACTO'];
export const TEMAS: TemaCaso[] = ['ASISTENCIA', 'CONDUCTA', 'DESEMPENO', 'SALUD', 'PAGO', 'OTRO'];
export const CANALES: CanalContacto[] = ['LLAMADA', 'WHATSAPP', 'EMAIL'];
export const RESULTADOS: ResultadoContacto[] = ['CONTESTO', 'NO_CONTESTO', 'RESPONDIO', 'SIN_RESPUESTA', 'PENDIENTE'];

/** Etiquetas para la UI. Los enums viajan crudos; el texto vive aquí. */
export const ESTADO_LABEL: Record<EstadoCaso, string> = {
  EN_GESTION: 'En gestión — mantiene abierto',
  RESUELTO: 'Resuelto',
  PROCESO_DE_CIERRE: 'Proceso de cierre',
  PROPUESTA_DE_CAMBIO: 'Propuesta de cambio',
  CIERRA_PROGRAMA: 'Cierra programa',
  REMITIDO_A_ACADEMICA: 'Remitido a Académica',
  PROGRAMA_CONGELADO: 'Programa congelado',
  PRE_JURIDICO: 'Pre-jurídico',
  SIN_CONTACTO: 'Sin contacto',
};

export const TEMA_LABEL: Record<TemaCaso, string> = {
  ASISTENCIA: 'Asistencia', CONDUCTA: 'Conducta', DESEMPENO: 'Desempeño',
  SALUD: 'Salud', PAGO: 'Pago', OTRO: 'Otro',
};

export interface Actor { email?: string | null; nombre?: string | null }

export interface CasoAbiertoResumen {
  _id: string;
  codigo: string;
  tema: TemaCaso;
  abiertoEn: string;
  diasAbierto: number;
  reportes: number;
  /** Última gestión registrada, para el aviso del panel del guía. */
  ultimaGestion: string | null;
}

/** El contrato del código va sin puntos ni guiones: `01-M5-2326-26` → `01M5232626`. */
export function contratoParaCodigo(contrato?: string | null): string {
  return String(contrato || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * Código del caso: `CA-<contrato sin puntos ni guiones>-<consecutivo>`, con el
 * consecutivo acotado a ESE contrato (ej. `CA-01M5232626-01`).
 *
 * Distinto del "N.º de caso del alumno" (`numeroCaso`), que cuenta cuántos ha
 * tenido esa persona: un contrato puede tener varios beneficiarios, así que los
 * dos números no coinciden.
 *
 * Se genera dentro de la transacción y bajo un advisory lock por contrato: sin
 * él, dos reportes simultáneos calcularían el mismo MAX+1 y el segundo chocaría
 * contra el UNIQUE de `codigo`.
 */
async function generarCodigo(client: any, contrato: string | null): Promise<string> {
  const limpio = contratoParaCodigo(contrato);
  if (!limpio) {
    // Sin contrato no hay serie a la que pertenecer; se marca para que salte a
    // la vista en vez de inventar un código que parezca válido.
    const { rows } = await client.query(
      `SELECT COUNT(*)::int + 1 AS n FROM "CASOS_ATENCION" WHERE "contrato" IS NULL`
    );
    return `CA-SINCONTRATO-${String(rows[0].n).padStart(2, '0')}`;
  }
  // hashtext da un int estable para el lock; el par (clave fija, hash) evita
  // colisionar con locks de otras partes del sistema.
  await client.query(`SELECT pg_advisory_xact_lock($1, hashtext($2))`, [8471, limpio]);
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(NULLIF(SPLIT_PART("codigo", '-', 3), '')::int), 0) + 1 AS n
       FROM "CASOS_ATENCION" WHERE "codigo" LIKE $1`,
    [`CA-${limpio}-%`]
  );
  return `CA-${limpio}-${String(rows[0].n).padStart(2, '0')}`;
}

/** Casos abiertos del alumno, con lo que el panel del guía necesita mostrar. */
export async function casosAbiertosDeAlumno(academicaId: string): Promise<CasoAbiertoResumen[]> {
  const { rows } = await query<any>(
    `SELECT c."_id", c."codigo", c."tema", c."abiertoEn",
            GREATEST(0, DATE_PART('day', NOW() - c."abiertoEn"))::int AS "diasAbierto",
            (SELECT COUNT(*)::int FROM "CASOS_REPORTES" r WHERE r."casoId" = c."_id") AS reportes,
            -- Última gestión = el contacto más reciente con el apoderado.
            (SELECT ct."canal" || ' · ' || ct."resultado" || ' el ' || TO_CHAR(ct."_createdDate" AT TIME ZONE 'America/Santiago', 'DD/MM')
               FROM "CASOS_CONTACTOS" ct WHERE ct."casoId" = c."_id"
              ORDER BY ct."_createdDate" DESC LIMIT 1) AS "ultimaGestion"
       FROM "CASOS_ATENCION" c
      WHERE c."academicaId" = $1 AND c."estado" = '${ESTADO_ABIERTO}'
      ORDER BY c."abiertoEn" DESC`,
    [academicaId]
  );
  return rows;
}

export interface CrearReporteInput {
  academicaId: string;
  texto: string;
  tema: TemaCaso;
  eventoId?: string | null;
  bookingId?: string | null;
  guiaId?: string | null;
  guiaNombre?: string | null;
  /**
   * A dónde va el reporte cuando el alumno YA tiene casos abiertos:
   * el `_id` de un caso abierto, o `'nuevo'` para abrir otro.
   * Sin casos abiertos se ignora — el reporte abre uno y no se pregunta (R2).
   */
  destino?: string | null;
}

export interface CrearReporteResult {
  reporteId: string;
  casoId: string;
  codigo: string;
  abrioCaso: boolean;
}

/**
 * Crea un reporte (R1). Si el alumno tiene casos abiertos y no se indicó
 * destino, NO escribe nada y lanza `ConflictError` con los casos abiertos en
 * `detail` para que el panel del guía pregunte (R2) — mismo patrón que la
 * colisión de guía.
 */
export async function crearReporte(input: CrearReporteInput): Promise<CrearReporteResult> {
  const academicaId = String(input.academicaId || '').trim();
  const texto = String(input.texto || '').trim();
  const tema = String(input.tema || '').trim().toUpperCase() as TemaCaso;

  if (!academicaId) throw new ValidationError('Falta el estudiante.');
  if (!texto) throw new ValidationError('El reporte no puede estar vacío.');
  if (!TEMAS.includes(tema)) throw new ValidationError(`Tema inválido: "${input.tema}".`);

  // El contrato alimenta el código del caso. Se resuelve desde la ficha del
  // BENEFICIARIO (no la del titular, que puede compartir numeroId).
  const alumno = await queryOne<{ _id: string; numeroId: string | null; casosCount: number; contrato: string | null }>(
    `SELECT a."_id", a."numeroId", COALESCE(a."casosCount", 0) AS "casosCount",
            COALESCE(
              (SELECT p."contrato" FROM "PEOPLE" p
                WHERE p."_id" = a."peopleId" AND COALESCE(p."contrato",'') <> '' LIMIT 1),
              (SELECT p2."contrato" FROM "PEOPLE" p2
                WHERE p2."numeroId" = a."numeroId"
                  AND p2."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA')
                  AND COALESCE(p2."contrato",'') <> '' LIMIT 1)
            ) AS "contrato"
       FROM "ACADEMICA" a WHERE a."_id" = $1`,
    [academicaId]
  );
  if (!alumno) throw new NotFoundError('Registro académico', academicaId);

  const abiertos = await casosAbiertosDeAlumno(academicaId);
  const destino = String(input.destino || '').trim();

  // R2: con casos abiertos hay que elegir; sin ellos se abre uno sin preguntar.
  if (abiertos.length > 0 && !destino) {
    throw new ConflictError(
      'El alumno ya tiene un caso abierto: indica si el reporte suma a ese caso o abre uno nuevo.',
      { tipo: 'caso_abierto', academicaId, casosAbiertos: abiertos }
    );
  }

  const sumarA = destino && destino !== 'nuevo'
    ? abiertos.find(c => c._id === destino)
    : null;
  if (destino && destino !== 'nuevo' && !sumarA) {
    throw new ValidationError('El caso indicado no existe o ya no está abierto.');
  }

  return transaction(async (client) => {
    let casoId: string;
    let codigo: string;
    const abrioCaso = !sumarA;

    if (sumarA) {
      casoId = sumarA._id;
      codigo = sumarA.codigo;
      await client.query(`UPDATE "CASOS_ATENCION" SET "_updatedDate" = NOW() WHERE "_id" = $1`, [casoId]);
    } else {
      casoId = ids.comment().replace(/^cmt_/, 'cas_');
      codigo = await generarCodigo(client, alumno.contrato);
      const numeroCaso = Number(alumno.casosCount || 0) + 1;

      await client.query(
        `INSERT INTO "CASOS_ATENCION"
           ("_id","codigo","academicaId","numeroId","contrato","numeroCaso","tema","estado","eventoOrigenId","abiertoPor")
         VALUES ($1,$2,$3,$4,$5,$6,$7,'${ESTADO_ABIERTO}',$8,$9)`,
        [casoId, codigo, academicaId, alumno.numeroId, alumno.contrato, numeroCaso, tema,
          input.eventoId || null, input.guiaNombre || input.guiaId || null]
      );
      // El "N.º de caso" del alumno vive en ACADEMICA (spec).
      await client.query(
        `UPDATE "ACADEMICA" SET "casosCount" = COALESCE("casosCount",0) + 1 WHERE "_id" = $1`,
        [academicaId]
      );
      await client.query(
        `INSERT INTO "CASOS_ESTADO_HISTORIAL"("_id","casoId","estadoAnterior","estadoNuevo","autorEmail","autorNombre","motivo")
         VALUES ($1,$2,NULL,'${ESTADO_ABIERTO}',$3,$4,'Caso abierto por un reporte del guía')`,
        [ids.comment(), casoId, input.guiaId || null, input.guiaNombre || null]
      );
    }

    const reporteId = ids.comment().replace(/^cmt_/, 'rep_');
    // R7: nace sin leer — también el que abre el caso, porque nadie lo ha visto.
    await client.query(
      `INSERT INTO "CASOS_REPORTES"
         ("_id","casoId","academicaId","texto","tema","eventoId","bookingId","guiaId","guiaNombre","abrioCaso","leido")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false)`,
      [reporteId, casoId, academicaId, texto, tema, input.eventoId || null,
        input.bookingId || null, input.guiaId || null, input.guiaNombre || null, abrioCaso]
    );

    // Origen ÚNICO: reportar aquí alimenta también el informe Servicio › Casos
    // de Atención, que sigue leyendo la marca del booking. Antes lo hacía el
    // textarea del panel de la sesión, que se retiró para no tener dos formas
    // de reportar lo mismo. Va en la misma transacción: si el caso se crea, la
    // marca se pone; si algo falla, no queda ni lo uno ni lo otro.
    if (input.bookingId) {
      await client.query(
        `UPDATE "ACADEMICA_BOOKINGS"
            SET "casoAtencion" = true, "advisorAnotaciones" = $1, "_updatedDate" = NOW()
          WHERE "_id" = $2`,
        [texto, input.bookingId]
      );
    }

    return { reporteId, casoId, codigo, abrioCaso };
  });
}

/**
 * Cambia el estado del caso. Salir de EN_GESTION **es** cerrarlo (R5): exige
 * acuerdo con el apoderado y fecha de compromiso ya registrados, y deja el caso
 * en solo lectura. Todo cambio queda en el historial (R6).
 */
export async function cambiarEstado(
  casoId: string, nuevo: EstadoCaso, actor: Actor, motivo?: string
): Promise<{ casoId: string; estado: EstadoCaso; cerrado: boolean }> {
  const estado = String(nuevo || '').trim().toUpperCase() as EstadoCaso;
  if (!ESTADOS.includes(estado)) throw new ValidationError(`Estado inválido: "${nuevo}".`);

  const caso = await queryOne<any>(
    `SELECT "_id","estado","acuerdo","fechaCompromiso" FROM "CASOS_ATENCION" WHERE "_id" = $1`,
    [casoId]
  );
  if (!caso) throw new NotFoundError('Caso de atención', casoId);
  if (caso.estado !== ESTADO_ABIERTO) {
    throw new ValidationError('El caso ya está cerrado: es de solo lectura.');
  }
  if (estado === caso.estado) return { casoId, estado, cerrado: false };

  // R5: cerrar exige el acuerdo registrado.
  if (!String(caso.acuerdo || '').trim() || !caso.fechaCompromiso) {
    throw new ValidationError(
      'Para cerrar el caso hace falta el acuerdo con el apoderado y la fecha de compromiso.'
    );
  }

  await transaction(async (client) => {
    await client.query(
      `UPDATE "CASOS_ATENCION"
          SET "estado" = $1, "cerradoPor" = $2, "cerradoEn" = NOW(), "_updatedDate" = NOW()
        WHERE "_id" = $3`,
      [estado, actor.email || actor.nombre || null, casoId]
    );
    await client.query(
      `INSERT INTO "CASOS_ESTADO_HISTORIAL"("_id","casoId","estadoAnterior","estadoNuevo","autorEmail","autorNombre","motivo")
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [ids.comment(), casoId, caso.estado, estado, actor.email || null, actor.nombre || null, motivo || null]
    );
  });

  return { casoId, estado, cerrado: true };
}

/** Agrega un intento de contacto (R8: sólo se agregan; el nº es automático). */
export async function agregarContacto(
  casoId: string,
  data: { canal: CanalContacto; resultado: ResultadoContacto; observacion?: string | null },
  actor: Actor
) {
  const canal = String(data.canal || '').trim().toUpperCase() as CanalContacto;
  const resultado = String(data.resultado || '').trim().toUpperCase() as ResultadoContacto;
  if (!CANALES.includes(canal)) throw new ValidationError(`Canal inválido: "${data.canal}".`);
  if (!RESULTADOS.includes(resultado)) throw new ValidationError(`Resultado inválido: "${data.resultado}".`);

  const caso = await queryOne<{ estado: string }>(`SELECT "estado" FROM "CASOS_ATENCION" WHERE "_id" = $1`, [casoId]);
  if (!caso) throw new NotFoundError('Caso de atención', casoId);
  if (caso.estado !== ESTADO_ABIERTO) throw new ValidationError('El caso está cerrado: es de solo lectura.');

  return transaction(async (client) => {
    // El nº de intento se calcula dentro de la transacción; el UNIQUE
    // (casoId, canal, intento) es la red por si dos gestores registran a la vez.
    const { rows } = await client.query(
      `SELECT COALESCE(MAX("intento"), 0) + 1 AS n FROM "CASOS_CONTACTOS"
        WHERE "casoId" = $1 AND "canal" = $2`,
      [casoId, canal]
    );
    const intento = Number(rows[0].n);
    const id = ids.comment().replace(/^cmt_/, 'con_');
    await client.query(
      `INSERT INTO "CASOS_CONTACTOS"("_id","casoId","canal","intento","resultado","observacion","autorEmail","autorNombre")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, casoId, canal, intento, resultado, data.observacion || null,
        actor.email || null, actor.nombre || null]
    );
    await client.query(`UPDATE "CASOS_ATENCION" SET "_updatedDate" = NOW() WHERE "_id" = $1`, [casoId]);
    return { _id: id, canal, intento, resultado };
  });
}

/** Acuerdo con el apoderado y seguimiento de finanzas (pertenecen al caso). */
export async function guardarGestion(
  casoId: string,
  data: { acuerdo?: string | null; fechaCompromiso?: string | null; responsable?: string | null; seguimientoFinanzas?: string | null }
) {
  const caso = await queryOne<{ estado: string }>(`SELECT "estado" FROM "CASOS_ATENCION" WHERE "_id" = $1`, [casoId]);
  if (!caso) throw new NotFoundError('Caso de atención', casoId);
  if (caso.estado !== ESTADO_ABIERTO) throw new ValidationError('El caso está cerrado: es de solo lectura.');

  // Sólo se tocan los campos enviados: guardar el acuerdo no debe borrar finanzas.
  const sets: string[] = [];
  const params: any[] = [];
  let i = 1;
  for (const [col, val] of [
    ['acuerdo', data.acuerdo], ['fechaCompromiso', data.fechaCompromiso],
    ['responsable', data.responsable], ['seguimientoFinanzas', data.seguimientoFinanzas],
  ] as const) {
    if (val !== undefined) { sets.push(`"${col}" = $${i++}`); params.push(val === '' ? null : val); }
  }
  if (!sets.length) return { casoId, actualizado: 0 };

  params.push(casoId);
  const r = await query(
    `UPDATE "CASOS_ATENCION" SET ${sets.join(', ')}, "_updatedDate" = NOW() WHERE "_id" = $${i}`,
    params
  );
  return { casoId, actualizado: r.rowCount ?? 0 };
}

/** R7: marca como leídos los reportes del caso al abrirlo un gestor. */
export async function marcarReportesLeidos(casoId: string, actor: Actor) {
  const r = await query(
    `UPDATE "CASOS_REPORTES"
        SET "leido" = true, "leidoPor" = $1, "leidoEn" = NOW()
      WHERE "casoId" = $2 AND "leido" = false`,
    [actor.email || actor.nombre || null, casoId]
  );
  return { marcados: r.rowCount ?? 0 };
}

/**
 * Detalle completo del caso para la pestaña del alumno.
 *
 * El contexto administrativo (curso, salón, horario, guía, contrato, apoderado,
 * asesor, ejecutivo de finanzas, estado de finanzas) NO vive en el caso: se
 * DERIVA de sus fuentes en cada lectura (R10). Copiarlo lo dejaría desfasado en
 * cuanto el alumno cambie de salón o el contrato de gestor.
 */
export async function getCasoDetalle(casoId: string) {
  const caso = await queryOne<any>(
    `SELECT c.*,
            -- Alumno
            TRIM(REGEXP_REPLACE(CONCAT_WS(' ', p."primerNombre", p."segundoNombre",
                 p."primerApellido", p."segundoApellido"), '\s+', ' ', 'g')) AS "alumno",
            -- Contexto académico: del alumno, no copiado al caso
            p."tipoCurso" AS "curso", p."salon", p."horarioCurso", p."campaign",
            g."nombreCompleto" AS "guiaCurso",
            -- Contexto administrativo: apoderado del beneficiario, el resto del titular
            p."apoderado", p."apoderadoTelefono", p."apoderadoMail",
            t."asesor" AS "asesorComercial",
            ur."nombre" || ' ' || COALESCE(ur."apellido",'') AS "ejecutivoFinanzas",
            pg."tipoCartera" AS "estadoFinanzas",
            fin."numeroCuotas", fin."cuotasPagadas", fin."saldo"
       FROM "CASOS_ATENCION" c
       JOIN "ACADEMICA" a ON a."_id" = c."academicaId"
       LEFT JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       LEFT JOIN "CURSOS_CAMPAIGN" cc
         ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso"
        AND cc."horarioCurso" = p."horarioCurso"
       LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
       LEFT JOIN LATERAL (
         SELECT * FROM "PEOPLE" tt
          WHERE tt."contrato" = p."contrato" AND tt."tipoUsuario" = 'TITULAR' LIMIT 1
       ) t ON true
       LEFT JOIN "USUARIOS_ROLES" ur ON ur."_id" = t."gestorRecaudo"
       LEFT JOIN LATERAL (
         SELECT "tipoCartera" FROM "PAGOS_TITULARES"
          WHERE "idPeople" = t."_id" AND "numCuota" = 0 LIMIT 1
       ) pg ON true
       LEFT JOIN LATERAL (
         SELECT "numeroCuotas", "cuotasPagadas", "saldo" FROM "FINANCIEROS"
          WHERE "contrato" = p."contrato" ORDER BY "_createdDate" DESC LIMIT 1
       ) fin ON true
      WHERE c."_id" = $1`,
    [casoId]
  );
  if (!caso) throw new NotFoundError('Caso de atención', casoId);

  const [reportes, contactos, historial, otrosAbiertos, cerrados] = await Promise.all([
    query<any>(
      `SELECT r.*, ev."dia" AS "sesionDia", ev."nivel" AS "sesionCurso", ev."salon" AS "sesionSalon"
         FROM "CASOS_REPORTES" r
         LEFT JOIN "CALENDARIO" ev ON ev."_id" = r."eventoId"
        WHERE r."casoId" = $1 ORDER BY r."_createdDate" DESC`, [casoId]),
    query<any>(
      `SELECT * FROM "CASOS_CONTACTOS" WHERE "casoId" = $1
        ORDER BY "canal", "intento"`, [casoId]),
    query<any>(
      `SELECT * FROM "CASOS_ESTADO_HISTORIAL" WHERE "casoId" = $1
        ORDER BY "_createdDate" DESC`, [casoId]),
    // R3: los otros casos abiertos del alumno, para que dos gestores no
    // contacten a la misma apoderada sin saberlo.
    query<any>(
      `SELECT "_id","codigo","tema" FROM "CASOS_ATENCION"
        WHERE "academicaId" = $1 AND "_id" <> $2 AND "estado" = '${ESTADO_ABIERTO}'
        ORDER BY "abiertoEn" DESC`, [caso.academicaId, casoId]),
    // Histórico: los casos ya cerrados del alumno.
    query<any>(
      `SELECT c."_id","codigo","tema","estado","abiertoEn","cerradoEn","acuerdo","seguimientoFinanzas",
              (SELECT COUNT(*)::int FROM "CASOS_REPORTES" r WHERE r."casoId" = c."_id") AS reportes
         FROM "CASOS_ATENCION" c
        WHERE c."academicaId" = $1 AND c."_id" <> $2 AND c."estado" <> '${ESTADO_ABIERTO}'
        ORDER BY c."cerradoEn" DESC NULLS LAST`, [caso.academicaId, casoId]),
  ]);

  // Total histórico de reportes del alumno: el "2 de 5" de la ficha.
  const { rows: [tot] } = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM "CASOS_REPORTES" WHERE "academicaId" = $1`,
    [caso.academicaId]
  );

  return {
    caso,
    reportes: reportes.rows,
    contactos: contactos.rows,
    historial: historial.rows,
    otrosCasosAbiertos: otrosAbiertos.rows,
    casosCerrados: cerrados.rows,
    reportesEnEsteCaso: reportes.rows.length,
    reportesTotalesAlumno: Number(tot?.n || 0),
    abierto: caso.estado === ESTADO_ABIERTO,
  };
}
