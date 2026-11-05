import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { RecaudosPermission } from '@/types/permissions';
import { moraService } from '@/services/mora.service';

/**
 * GET /api/postgres/recaudos/usuarios-mora
 *
 * Titulares APROBADOS cuyo contrato está en mora (cuotas vencidas sin registrar,
 * misma regla de la pestaña Financiera — src/lib/mora.ts). Respeta el alcance por
 * plataforma de Recaudos. Gateado por RECAUDOS.USUARIOS_MORA.VER.
 */
export const GET = handlerWithAuth(async (_req, _ctx, session) => {
  await requirePermission(session, RecaudosPermission.USUARIOS_MORA_VER as any);
  const u = (session as any)?.user;
  const usuarios = await moraService.listarEnMora({ email: u?.email ?? null, role: String(u?.role ?? '') });
  return successResponse({ usuarios, count: usuarios.length });
});
