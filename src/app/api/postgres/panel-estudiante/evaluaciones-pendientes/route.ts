/**
 * GET /api/postgres/panel-estudiante/evaluaciones-pendientes
 *
 * Devuelve las sesiones ASISTIDAS por el estudiante autenticado que aún
 * no tienen evaluación. Se usa para:
 *   - Mostrar la tarjeta "⭐ Sin Evaluar" en /panel-estudiante.
 *   - Hard block antes de agendar (si rows.length > 0).
 *
 * Respeta el feature flag (off → array vacío, beta → array vacío salvo si
 * el email del estudiante está en la whitelist).
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { resolveStudentFromSession } from '@/services/panel-estudiante.service';
import { isEnabledForEmail, findEvaluablesForStudent } from '@/services/evaluations.service';

export const GET = handlerWithAuth(async (_request, _ctx, session) => {
  const email = (session?.user as any)?.email ?? '';
  const enabled = await isEnabledForEmail(email);
  if (!enabled) {
    return successResponse({ featureEnabled: false, rows: [], total: 0 });
  }

  const student = await resolveStudentFromSession(session as any);
  if (!student) return successResponse({ featureEnabled: true, rows: [], total: 0 });

  const rows = await findEvaluablesForStudent(student._id);
  return successResponse({ featureEnabled: true, rows, total: rows.length });
});
