import 'server-only';
import { query, transaction } from '@/lib/postgres';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { cupoOcupadoSql } from '@/lib/cupo';
import { lockSalon } from '@/services/cupo-guard.service';

/**
 * Confirmación del CUPO al marcar un contrato como "listo" (Gestión Contrato).
 *
 * Al crear el contrato el curso se guarda pero el cupo NO se reserva
 * (`PEOPLE.cupoConfirmado = false`): la asignación es provisional. Aquí es donde
 * se comprueba que el salón todavía tenga lugar y se toma el asiento de verdad.
 *
 * Si algún beneficiario no cabe, NO se escribe nada y se devuelve el detalle
 * para que la interfaz pregunte qué hacer: cambiar de horario (a uno con cupo)
 * o autorizar un sobrecupo. Ambas salidas vuelven a pasar por aquí, así que el
 * cupo se re-verifica en el último momento — entre que se abre el modal y se
 * decide, otro comercial pudo haberse llevado el asiento.
 */

/** Beneficiario provisional que hay que confirmar. */
export interface BenefPorConfirmar {
  personId: string;
  nombre: string;
  numeroId: string | null;
  campaign: string | null;
  tipoCurso: string | null;
  horarioCurso: string | null;
  salon: string | null;
  cupos: number;
  ocupados: number;
  /** Horarios del MISMO curso y campaña que sí tienen lugar. */
  alternativas: Alternativa[];
}

export interface Alternativa {
  campaign: string;
  tipoCurso: string;
  horarioCurso: string;
  salon: string | null;
  cupos: number;
  ocupados: number;
  libres: number;
}

export interface ResultadoConfirmacion {
  confirmados: number;
  sobrecupos: number;
  /** Beneficiarios que se movieron de horario, para el resumen de la UI. */
  movidos: { nombre: string; de: string; a: string }[];
}

/** Cambio de horario pedido desde el modal. */
export interface CambioHorario {
  personId: string;
  campaign: string;
  tipoCurso: string;
  horarioCurso: string;
}

const nombreDe = (r: any) =>
  [r.primerNombre, r.primerApellido].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || r.numeroId || r._id;

/**
 * Advisory lock por SALÓN, dentro de la transacción.
 *
 * Sin esto, dos comerciales confirmando el último asiento del mismo salón a la
 * vez leerían "queda 1" los dos y lo tomarían los dos. `hashtext` reduce la
 * terna a un entero, que es lo que acepta el lock.
 */
// (vive en cupo-guard.service para que TODAS las vías tomen el MISMO lock: dos
// claves construidas por separado no se excluirían entre sí.)

/** Cuenta cuántos asientos están tomados AHORA en ese salón. */
async function contarOcupados(
  client: any, campaign: string, tipoCurso: string, horarioCurso: string, excluir: string[] = []
): Promise<number> {
  // `excluir` son los beneficiarios que se están confirmando AHORA. Su reserva
  // temporal ya los cuenta como ocupantes, y el bucle les vuelve a sumar un
  // asiento al repartirlos: sin excluirlos, un contrato se rechazaría a sí mismo
  // por su propia reserva.
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM "PEOPLE" pe
      WHERE pe."tipoUsuario" = 'BENEFICIARIO'
        AND pe."campaign" = $1 AND pe."tipoCurso" = $2 AND pe."horarioCurso" = $3
        AND pe."_id" <> ALL($4::text[])
        AND ${cupoOcupadoSql('pe')}`,
    [campaign, tipoCurso, horarioCurso, excluir]
  );
  return Number(r.rows[0]?.n ?? 0);
}

/** Cupos declarados del salón (0 = sin límite definido). */
async function cuposDe(client: any, campaign: string, tipoCurso: string, horarioCurso: string) {
  const r = await client.query(
    `SELECT "salon", COALESCE("numeroUsuarios", 0) AS cupos FROM "CURSOS_CAMPAIGN"
      WHERE "campaign"=$1 AND "tipoCurso"=$2 AND "horarioCurso"=$3 LIMIT 1`,
    [campaign, tipoCurso, horarioCurso]
  );
  return { salon: r.rows[0]?.salon ?? null, cupos: Number(r.rows[0]?.cupos ?? 0), existe: r.rows.length > 0 };
}

/**
 * Otros horarios del mismo curso y campaña que TIENEN lugar. Es lo que llena el
 * desplegable del modal, ya filtrado: no se ofrece un destino que fuera a
 * rechazarse al confirmarlo.
 */
export async function alternativasConCupo(
  campaign: string, tipoCurso: string, excluirHorario: string | null
): Promise<Alternativa[]> {
  const { rows } = await query<any>(
    `SELECT cc."campaign", cc."tipoCurso", cc."horarioCurso", cc."salon",
            COALESCE(cc."numeroUsuarios", 0) AS cupos,
            (SELECT COUNT(*)::int FROM "PEOPLE" pe
              WHERE pe."tipoUsuario"='BENEFICIARIO'
                AND pe."campaign"=cc."campaign" AND pe."tipoCurso"=cc."tipoCurso"
                AND pe."horarioCurso"=cc."horarioCurso" AND ${cupoOcupadoSql('pe')}) AS ocupados
       FROM "CURSOS_CAMPAIGN" cc
      WHERE cc."activa" = true AND cc."campaign" = $1 AND cc."tipoCurso" = $2
        AND ($3::text IS NULL OR cc."horarioCurso" <> $3)
      ORDER BY cc."horarioCurso", cc."salon"`,
    [campaign, tipoCurso, excluirHorario]
  );
  return rows
    .map(r => ({ ...r, cupos: Number(r.cupos), ocupados: Number(r.ocupados), libres: Number(r.cupos) - Number(r.ocupados) }))
    // `cupos = 0` significa "sin límite definido", así que también sirve.
    .filter(r => r.cupos === 0 || r.libres > 0);
}

/** Beneficiarios del contrato que aún no tienen el cupo tomado. */
async function provisionalesDelContrato(client: any, titularId: string) {
  const t = await client.query(
    `SELECT "_id", "contrato", "gestionContratoListo" FROM "PEOPLE" WHERE "_id"=$1 AND "tipoUsuario"='TITULAR'`,
    [titularId]
  );
  if (!t.rows.length) throw new NotFoundError('No se encontró el titular.');
  const contrato = t.rows[0].contrato;

  const { rows } = await client.query(
    `SELECT "_id", "primerNombre", "primerApellido", "numeroId", "campaign", "tipoCurso", "horarioCurso", "salon"
       FROM "PEOPLE"
      WHERE "contrato" = $1 AND "tipoUsuario" = 'BENEFICIARIO'
        AND "cupoConfirmado" IS NOT TRUE
        AND "cupoLiberado" IS NOT TRUE
      ORDER BY "primerApellido", "primerNombre"`,
    [contrato]
  );
  return { contrato, titular: t.rows[0], provisionales: rows };
}

/**
 * Marca el contrato como listo tomando el cupo de cada beneficiario provisional.
 *
 * - `cambios`: mueve de horario antes de confirmar (viene del modal).
 * - `sobrecupo`: autoriza pasarse del límite. Aun así se vuelve a contar: si
 *   entretanto se liberó un asiento, se confirma normal y NO se registra el
 *   sobrecupo — no tiene sentido dejar constancia de una excepción que no ocurrió.
 *
 * Lanza `ValidationError` con `detail.tipo='sin_cupo'` (409) cuando falta lugar
 * y no se autorizó nada. En ese caso no se escribe NADA.
 */
export async function marcarListoConCupo(opts: {
  titularId: string;
  actor: string;
  cambios?: CambioHorario[];
  sobrecupo?: boolean;
}): Promise<ResultadoConfirmacion> {
  const { titularId, actor } = opts;
  const cambios = opts.cambios || [];
  const sobrecupo = opts.sobrecupo === true;

  return transaction(async (client) => {
    const { provisionales } = await provisionalesDelContrato(client, titularId);

    // Destino final de cada beneficiario: el que pidió el modal, o el que ya tenía.
    const destino = new Map<string, { campaign: string | null; tipoCurso: string | null; horarioCurso: string | null }>();
    for (const b of provisionales) {
      const c = cambios.find(x => x.personId === b._id);
      destino.set(b._id, c
        ? { campaign: c.campaign, tipoCurso: c.tipoCurso, horarioCurso: c.horarioCurso }
        : { campaign: b.campaign, tipoCurso: b.tipoCurso, horarioCurso: b.horarioCurso });
    }

    // Bloquear los salones implicados en orden estable — bloquearlos en órdenes
    // distintos entre dos peticiones simultáneas podría trabarlas mutuamente.
    const salones = Array.from(new Set(
      Array.from(destino.values())
        .filter(d => d.campaign && d.tipoCurso && d.horarioCurso)
        .map(d => `${d.campaign}|${d.tipoCurso}|${d.horarioCurso}`)
    )).sort();
    for (const s of salones) {
      const [campaign, tipoCurso, horarioCurso] = s.split('|');
      await lockSalon(client, campaign, tipoCurso, horarioCurso);
    }

    // Con los salones bloqueados, contar de nuevo y repartir los asientos. Los
    // hermanos del mismo contrato al mismo salón se cuentan uno tras otro.
    const ocupadosPorSalon = new Map<string, number>();
    const sinCupo: BenefPorConfirmar[] = [];
    const aConfirmar: { b: any; d: any; excede: boolean }[] = [];

    for (const b of provisionales) {
      const d = destino.get(b._id)!;
      if (!d.campaign || !d.tipoCurso || !d.horarioCurso) {
        // Sin curso asignado no hay cupo que tomar: se confirma sin salón.
        aConfirmar.push({ b, d, excede: false });
        continue;
      }
      const key = `${d.campaign}|${d.tipoCurso}|${d.horarioCurso}`;
      const { cupos, salon, existe } = await cuposDe(client, d.campaign, d.tipoCurso, d.horarioCurso);
      if (!existe) throw new ValidationError(`El curso ${d.tipoCurso} ${d.horarioCurso} no existe en la campaña ${d.campaign}.`);

      if (!ocupadosPorSalon.has(key)) {
        ocupadosPorSalon.set(key, await contarOcupados(
          client, d.campaign, d.tipoCurso, d.horarioCurso, provisionales.map((p: any) => p._id)));
      }
      const ocupados = ocupadosPorSalon.get(key)!;
      const cabe = cupos === 0 || ocupados < cupos;

      if (cabe || sobrecupo) {
        aConfirmar.push({ b, d, excede: !cabe });
        ocupadosPorSalon.set(key, ocupados + 1);
      } else {
        sinCupo.push({
          personId: b._id,
          nombre: nombreDe(b),
          numeroId: b.numeroId,
          campaign: d.campaign, tipoCurso: d.tipoCurso, horarioCurso: d.horarioCurso,
          salon, cupos, ocupados,
          alternativas: await alternativasConCupo(d.campaign, d.tipoCurso, d.horarioCurso),
        });
      }
    }

    if (sinCupo.length) {
      // Nada escrito: el modal decide y se vuelve a entrar por aquí.
      const err: any = new ValidationError(
        sinCupo.length === 1
          ? `El salón de ${sinCupo[0].nombre} ya no tiene cupo.`
          : `${sinCupo.length} beneficiarios quedaron sin cupo en su salón.`
      );
      err.detail = { tipo: 'sin_cupo', titularId, beneficiarios: sinCupo };
      throw err;
    }

    const movidos: ResultadoConfirmacion['movidos'] = [];
    let sobrecupos = 0;

    for (const { b, d, excede } of aConfirmar) {
      const cambio = cambios.find(x => x.personId === b._id);
      if (cambio) {
        const { salon } = await cuposDe(client, d.campaign, d.tipoCurso, d.horarioCurso);
        await client.query(
          `UPDATE "PEOPLE" SET "campaign"=$2, "tipoCurso"=$3, "horarioCurso"=$4, "salon"=$5, "_updatedDate"=NOW()
            WHERE "_id"=$1`,
          [b._id, d.campaign, d.tipoCurso, d.horarioCurso, salon]
        );
        // ACADEMICA guarda la campaña y el salón por su cuenta (best-effort:
        // un beneficiario recién creado puede no tener aún su registro).
        await client.query(
          `UPDATE "ACADEMICA" SET "campaign"=$2, "salon"=$3, "_updatedDate"=NOW() WHERE "numeroId"=$1`,
          [b.numeroId, d.campaign, salon]
        ).catch(() => {});
        // Si el alumno YA tenía clases (contrato aprobado antes de re-marcar
        // listo), las del salón viejo se sueltan aquí. Hoy no ocurre —a esta
        // altura el contrato no está aprobado y no hay ninguna, verificado en los
        // 7 casos vigentes—, pero mover el curso sin mover las clases es el fallo
        // que ya dejó alumnos en dos salones a la vez; la regla queda pareja en
        // los tres sitios que escriben el curso.
        const soltadas = await client.query(
          `DELETE FROM "ACADEMICA_BOOKINGS" k
            USING "CALENDARIO" c, "ACADEMICA" a
            WHERE (c."_id" = k."eventoId" OR c."_id" = k."idEvento")
              AND c."dia" >= NOW()
              AND (k."idEstudiante" = a."_id" OR k."studentId" = a."_id")
              AND a."peopleId" = $1
              AND c."cursoCampaignId" = (
                SELECT cc."_id" FROM "CURSOS_CAMPAIGN" cc
                 WHERE cc."campaign" = $2 AND cc."tipoCurso" = $3 AND cc."horarioCurso" = $4 LIMIT 1)
            RETURNING c."_id" AS evid`,
          [b._id, b.campaign, b.tipoCurso, b.horarioCurso]
        ).catch(() => ({ rows: [] as any[] }));
        const evs = Array.from(new Set((soltadas.rows || []).map((r: any) => r.evid).filter(Boolean)));
        if (evs.length) {
          await client.query(
            `UPDATE "CALENDARIO" SET "inscritos" = GREATEST(0, COALESCE("inscritos",0) - 1), "_updatedDate"=NOW()
              WHERE "_id" = ANY($1::text[])`, [evs]);
        }

        if (b.horarioCurso !== d.horarioCurso || b.tipoCurso !== d.tipoCurso) {
          movidos.push({
            nombre: nombreDe(b),
            de: `${b.tipoCurso || '—'} ${b.horarioCurso || ''}`.trim(),
            a: `${d.tipoCurso} ${d.horarioCurso}`,
          });
        }
      }

      if (excede) sobrecupos++;
      await client.query(
        `UPDATE "PEOPLE"
            SET "cupoConfirmado" = true, "cupoConfirmadoPor" = $2, "cupoConfirmadoEn" = NOW(),
                -- Confirmado el asiento, la reserva temporal sobra.
                "cupoReservadoHasta" = NULL,
                "sobrecupoAutorizado" = $3,
                "sobrecupoAutorizadoPor" = CASE WHEN $3 THEN $2 ELSE "sobrecupoAutorizadoPor" END,
                "sobrecupoAutorizadoEn"  = CASE WHEN $3 THEN NOW() ELSE "sobrecupoAutorizadoEn" END,
                "_updatedDate" = NOW()
          WHERE "_id" = $1`,
        [b._id, actor, excede]
      );
    }

    await client.query(
      `UPDATE "PEOPLE" SET "gestionContratoListo"=true, "gestionContratoListoBy"=$2,
                           "gestionContratoListoDate"=NOW(), "_updatedDate"=NOW()
        WHERE "_id"=$1 AND "tipoUsuario"='TITULAR'`,
      [titularId, actor]
    );

    return { confirmados: aConfirmar.length, sobrecupos, movidos };
  });
}
