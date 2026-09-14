import 'server-only';
import { query } from '@/lib/postgres';
import { ValidationError } from '@/lib/errors';
import { ESTADOS_LIBERAN_CUPO } from '@/lib/cupo-estados';
import { normalizeNumeroId } from '@/lib/numeroid-normalize';

/**
 * Regla de INSCRIPCIÓN como beneficiario (MOSAICO).
 *
 * Un TITULAR puede tener varios contratos, pero una persona sólo puede estar
 * INSCRITA COMO ALUMNO en UNO. Esa inscripción es la que ocupa un asiento en un
 * salón y genera agendamientos, así que dos a la vez significan una persona en
 * dos cursos.
 *
 * Al inscribir `numeroId` como BENEFICIARIO del contrato `contratoDestino`:
 *
 *   A) ¿Ya es BENEFICIARIO en algún contrato con la inscripción VIVA?
 *      → se rechaza, nombrando el contrato donde ya está. Aplica siempre.
 *   B) ¿Es TITULAR del MISMO contrato al que se le está inscribiendo?
 *      → se PERMITE: es su propia inscripción (el "¿Este titular será
 *        beneficiario?" de Crear Contrato, o el alta hecha después de la
 *        aprobación). Da igual cuántos OTROS contratos tenga: tener varios está
 *        permitido, lo que se limita es en cuántos está inscrito como alumno.
 *   C) ¿Es TITULAR de algún contrato vivo, y el destino NO es suyo?
 *      → se rechaza: mientras su contrato siga en marcha no puede irse a cursar
 *        al de otro. Si en el suyo ya está inactivo, sí puede.
 *
 * ⚠ Por qué NO se reusa `cupoOcupadoSql` tal cual: esa regla exige además
 * `cupoConfirmado` o reserva vigente, porque mide quién ocupa un asiento HOY.
 * Aquí la pregunta es otra —si la persona ya está inscrita— y hay beneficiarios
 * cuyo contrato aún no se ha dejado listo (sin cupo confirmado) que son
 * inscripciones perfectamente vivas: con aquella regla pasarían el filtro y la
 * persona quedaría en dos contratos.
 */

/** Estado normalizado del contrato leído de la fila del TITULAR. */
function contratoMuerto(aprobacionTitular: string, estadoTitular: string): string | null {
  const ap = String(aprobacionTitular || '').trim();
  const est = String(estadoTitular || '').trim();
  if ((ESTADOS_LIBERAN_CUPO as readonly string[]).includes(ap.toLowerCase())) return ap;
  if (ap.toUpperCase() === 'FINALIZADA' || est.toUpperCase() === 'FINALIZADA') return 'Finalizado';
  return null;
}

export type Fila = {
  numeroId: string;
  tipoUsuario: string;
  contrato: string | null;
  primerNombre: string | null;
  primerApellido: string | null;
  estadoInactivo: boolean | null;
  suspendAccion: string;
  aprobacion: string;
  estado: string;
  aprobacionTitular: string;
  estadoTitular: string;
};

/**
 * Motivo por el que ESA fila ya no cuenta como inscripción/contrato vivo, o
 * `null` si sigue viva.
 *
 * Una inscripción está muerta si (a) el contrato completo cayó —Devuelto,
 * Rechazado, Retractado, Contrato nulo o Finalizado—, o (b) a esa persona la
 * inactivó un admin a propósito (`suspenddata.accion = 'INACTIVACION'`, la misma
 * señal del distintivo "SUSPENDIDA").
 *
 * NO cuenta como muerta el `estadoInactivo` a secas: un beneficiario **nace
 * inactivo** mientras no lo aprueben y esa inscripción sí está viva. Tampoco el
 * OnHold (está pausado, no dado de baja) ni `cupoLiberado` (soltó el asiento
 * pero sigue inscrito).
 */
export function motivoNoVive(f: Fila): string | null {
  const porContrato = contratoMuerto(f.aprobacionTitular || f.aprobacion, f.estadoTitular || f.estado);
  if (porContrato) return porContrato;
  if (String(f.aprobacion || '').trim().toUpperCase() === 'FINALIZADA') return 'Finalizado';
  if (String(f.estado || '').trim().toUpperCase() === 'FINALIZADA') return 'Finalizado';
  if (f.estadoInactivo === true && f.suspendAccion === 'INACTIVACION') return 'Inactivo';
  return null;
}

export const nombreDe = (f: Fila) => `${f.primerNombre || ''} ${f.primerApellido || ''}`.trim();

/**
 * Lanza `ValidationError` si `numeroId` no puede inscribirse como BENEFICIARIO
 * del contrato `contratoDestino`.
 *
 * `contratoDestino` va en `null` cuando el contrato todavía no existe (Crear
 * Contrato genera el número después de validar): ahí ninguna fila puede ser
 * "del mismo contrato", así que el caso C no aplica.
 */
export async function assertPuedeInscribirBeneficiario(
  numeroId: string,
  contratoDestino: string | null
): Promise<void> {
  // Se compara NORMALIZADO a los DOS lados: quedan 21 filas legadas guardadas con
  // puntos y guiones ("26.008.510-7"), y sin esto una persona que ya está inscrita
  // ahí pasaría el filtro por la diferencia de signos.
  const id = normalizeNumeroId(numeroId);
  if (!id) return;

  const r = await query<Fila>(
    `SELECT p."numeroId", p."tipoUsuario", p."contrato", p."primerNombre", p."primerApellido",
            p."estadoInactivo",
            COALESCE(p."suspenddata"->>'accion', '') AS "suspendAccion",
            COALESCE(p."aprobacion", '')             AS "aprobacion",
            COALESCE(p."estado", '')                 AS "estado",
            COALESCE(t."aprobacion", '')             AS "aprobacionTitular",
            COALESCE(t."estado", '')                 AS "estadoTitular"
       FROM "PEOPLE" p
       LEFT JOIN LATERAL (
         SELECT t2."aprobacion", t2."estado"
           FROM "PEOPLE" t2
          WHERE t2."contrato" = p."contrato"
            AND t2."tipoUsuario" = 'TITULAR'
          ORDER BY t2."_createdDate" DESC NULLS LAST
          LIMIT 1
       ) t ON TRUE
      WHERE UPPER(REGEXP_REPLACE(COALESCE(p."numeroId", ''), '[.[:space:]_-]', '', 'g')) = $1`,
    [id]
  );
  if (!r.rows.length) return;

  decidirInscripcion(r.rows, contratoDestino);
}

/**
 * La decisión, sin base de datos: recibe TODAS las filas de PEOPLE de esa persona
 * (con el estado de su titular ya resuelto) y lanza si no puede inscribirse.
 * Vive aparte para poder fijarla con pruebas — es una regla de negocio, no una
 * consulta.
 */
export function decidirInscripcion(filas: Fila[], contratoDestino: string | null): void {
  if (!filas.length) return;
  const id = String(filas[0].numeroId || '').trim();
  const destino = String(contratoDestino || '').trim();
  const nombre = nombreDe(filas[0]) || id;

  // (A) Ya inscrito como alumno en alguna parte.
  const inscripciones = filas.filter((f) => f.tipoUsuario === 'BENEFICIARIO');
  const vivaMismoContrato = inscripciones.find(
    (f) => destino && String(f.contrato || '').trim() === destino && !motivoNoVive(f)
  );
  if (vivaMismoContrato) {
    throw new ValidationError(
      `${nombre} (ID ${id}) ya está inscrito como beneficiario en este contrato.`
    );
  }
  const vivaOtroContrato = inscripciones.find((f) => !motivoNoVive(f));
  if (vivaOtroContrato) {
    throw new ValidationError(
      `${nombre} (ID ${id}) ya está inscrito como beneficiario en el contrato ${vivaOtroContrato.contrato}. ` +
        `Una persona sólo puede ser beneficiario de un contrato: primero debe quedar inactiva en ese.`
    );
  }

  // (B) Es titular del contrato al que se le inscribe → es SU contrato: pasa, sin
  // importar cuántos otros contratos tenga. Tener varios está permitido; lo que la
  // regla limita es en cuántos está INSCRITO como alumno, y eso ya lo cubre (A).
  const esTitularDelDestino =
    !!destino && filas.some((f) => f.tipoUsuario === 'TITULAR' && String(f.contrato || '').trim() === destino);
  if (esTitularDelDestino) return;

  // (C) Titular de un contrato vivo que NO es el destino: no puede irse a cursar
  // al contrato de otro mientras el suyo siga en marcha.
  const titularOtroVivo = filas.find(
    (f) => f.tipoUsuario === 'TITULAR' && !motivoNoVive(f)
  );
  if (titularOtroVivo) {
    throw new ValidationError(
      `${nombre} (ID ${id}) es titular del contrato ${titularOtroVivo.contrato}, que sigue activo. ` +
        `Sólo puede inscribirse como beneficiario de su propio contrato, o de otro si en el suyo ya está inactivo.`
    );
  }
}
