import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { ComercialPermission } from '@/types/permissions';
import { dejarContratoListo } from '@/services/dejar-listo.service';

/**
 * POST /api/postgres/people/[id]/listo-aprobacion
 *
 * Botón amarillo "Contrato Para Aprobación" del detalle del contrato.
 *
 * Deja el contrato LISTO de verdad: toma el cupo de cada beneficiario y pone la
 * marca de gestión (`gestionContratoListo`), que es la que exige la aprobación —
 * exactamente lo mismo que «Dejar listo» en Comercial › Gestión Contrato
 * (`dejarContratoListo` es la única definición). Además registra el aviso del
 * comercial (`listoAprobacion`), la marca «avisado» del Centro de Aprobación.
 *
 * Hasta sep-2026 sólo escribía el aviso: el comercial veía «✓ Listo para
 * aprobación» y la aprobación se lo rechazaba con "Comercial debe marcarlo en
 * Gestión Contrato".
 *
 * Body (los mismos del modal de sin cupo):
 *   {}                                   → confirmar tal cual
 *   { cambios: [{personId, campaign, tipoCurso, horarioCurso}] } → mover y confirmar
 *   { sobrecupo: true }                  → autorizar pasarse del cupo (permiso aparte)
 *
 * Si falta lugar responde con `detail.tipo='sin_cupo'` SIN escribir nada, para
 * que la pantalla ofrezca cambiar de horario o autorizar el sobrecupo.
 */
export const POST = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, ComercialPermission.CONTRATO_LISTO_APROBACION);
  const b = await request.json().catch(() => ({}));
  const r = await dejarContratoListo(session, {
    titularId: params.id,
    cambios: b?.cambios,
    sobrecupo: b?.sobrecupo,
    marcarAviso: true,
  });
  return successResponse(r);
});
