import 'server-only';
import { query, queryOne } from '@/lib/postgres';
import { ValidationError } from '@/lib/errors';
import { requirePermission } from '@/lib/api-permissions';
import { ComercialPermission } from '@/types/permissions';
import { getSessionComercialScope } from '@/lib/crm';
import { esAprobado } from '@/lib/estados';
import { marcarListoConCupo, type CambioHorario, type ResultadoConfirmacion } from '@/services/gestion-cupo.service';

/**
 * "Dejar listo" un contrato — la ÚNICA definición, con dos puertas de entrada:
 *
 *   - Comercial › Gestión Contrato › «Dejar listo»          (permiso GESTION_CONTRATO)
 *   - Detalle del contrato › «Contrato Para Aprobación»     (permiso CONTRATO_LISTO_APROBACION)
 *
 * Hasta sep-2026 el botón del detalle escribía sólo `listoAprobacion` —un aviso—
 * mientras la aprobación exige `gestionContratoListo`, que únicamente ponía
 * Gestión Contrato al tomar el cupo. El comercial veía «✓ Listo para aprobación»
 * y la aprobación se lo rechazaba. Las dos puertas pasan por aquí para que
 * dejen el contrato en el MISMO estado: cupo tomado y marca de gestión.
 *
 * El permiso de la puerta lo valida cada endpoint (son distintos a propósito);
 * aquí van las reglas comunes: alcance por líder, contrato firmado, no aprobado,
 * el permiso aparte del sobrecupo, y el aviso del comercial cuando corresponde.
 */
export interface DejarListoOpts {
  titularId: string;
  /** Movimientos de horario decididos en el modal de sin cupo. */
  cambios?: unknown;
  /** Autorizar pasarse del cupo (exige GESTION_CONTRATO_SOBRECUPO). */
  sobrecupo?: unknown;
  /**
   * Además de dejarlo listo, registra el aviso del comercial (`listoAprobacion`,
   * la marca «avisado» del Centro de Aprobación). Lo pone el botón del detalle.
   */
  marcarAviso?: boolean;
}

export interface DejarListoResultado extends ResultadoConfirmacion {
  ok: true;
  contrato: string | null;
  yaEstabaListo: boolean;
  message: string;
}

/** Deja en forma la lista de cambios que manda el navegador. */
export function sanitizarCambios(raw: unknown): CambioHorario[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c: any) => c?.personId && c?.campaign && c?.tipoCurso && c?.horarioCurso)
    .map((c: any) => ({
      personId: String(c.personId),
      campaign: String(c.campaign),
      tipoCurso: String(c.tipoCurso),
      horarioCurso: String(c.horarioCurso),
    }));
}

export async function dejarContratoListo(session: any, opts: DejarListoOpts): Promise<DejarListoResultado> {
  const titularId = String(opts.titularId || '').trim();
  if (!titularId) throw new ValidationError('Falta el titular.');

  const email: string = session?.user?.email || 'desconocido';
  const scope = await getSessionComercialScope(session);

  // El alcance por líder se verifica ANTES de tocar cupos: un comercial no
  // puede cerrar el contrato de otro equipo ni siquiera para reservarle un asiento.
  const params: any[] = [titularId];
  let scopeSql = '';
  if (!scope.seeAll) {
    params.push(scope.liderCorreo);
    scopeSql = ` AND LOWER("liderComercialCorreo") = LOWER($${params.length})`;
  }
  const titular = await queryOne<{
    _id: string; contrato: string | null; hashConsentimiento: string | null;
    aprobacion: string | null; gestionContratoListo: boolean | null; listoAprobacion: string | null;
  }>(
    `SELECT "_id", "contrato", "hashConsentimiento", "aprobacion",
            "gestionContratoListo", "listoAprobacion"::text
       FROM "PEOPLE"
      WHERE "_id" = $1 AND "tipoUsuario" = 'TITULAR'${scopeSql}`,
    params
  );
  if (!titular) throw new ValidationError('No se encontró el titular (o está fuera de tu equipo).');

  // Las mismas dos condiciones con las que la bandeja decide qué mostrar, pero
  // validadas en el SERVIDOR: que no salga en pantalla no impide un POST directo.
  if (!String(titular.hashConsentimiento || '').trim()) {
    throw new ValidationError(
      'El contrato aún no está firmado: el titular debe firmar el consentimiento ' +
      '(o registrarse la Acción Administrativa) antes de dejarlo listo.'
    );
  }
  if (esAprobado(titular.aprobacion)) {
    throw new ValidationError('El contrato ya está aprobado: marcarlo listo no aplica.');
  }

  const sobrecupo = opts.sobrecupo === true;
  // Autorizar un sobrecupo es ampliar el salón de hecho, así que va por su
  // propio permiso: el comercial ve el modal pero sólo puede cambiar el horario.
  if (sobrecupo) await requirePermission(session, ComercialPermission.GESTION_CONTRATO_SOBRECUPO);

  const yaEstabaListo = titular.gestionContratoListo === true;
  // Idempotente: sobre un contrato ya listo sólo confirma lo que hubiera
  // quedado provisional (normalmente nada) y vuelve a dejar la marca.
  const r = await marcarListoConCupo({ titularId, actor: email, cambios: sanitizarCambios(opts.cambios), sobrecupo });

  if (opts.marcarAviso && !titular.listoAprobacion) {
    await query(
      `UPDATE "PEOPLE"
          SET "listoAprobacion" = NOW(), "listoAprobacionPor" = $2, "_updatedDate" = NOW()
        WHERE "_id" = $1`,
      [titularId, email]
    );
  }

  const partes = [`${r.confirmados} beneficiario(s) con el cupo tomado`];
  if (r.movidos.length) partes.push(`${r.movidos.length} cambiado(s) de horario`);
  if (r.sobrecupos) partes.push(`${r.sobrecupos} con sobrecupo autorizado`);
  const message = yaEstabaListo && r.confirmados === 0
    ? 'El contrato ya estaba listo para aprobación.'
    : `Contrato listo — ${partes.join(' · ')}.`;

  return { ok: true, ...r, contrato: titular.contrato, yaEstabaListo, message };
}
