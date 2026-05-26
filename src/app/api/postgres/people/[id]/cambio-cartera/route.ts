import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import { requirePermission } from '@/lib/api-permissions';
import { PersonPermission } from '@/types/permissions';
import { pagosTitularesService } from '@/services/pagos-titulares.service';

/**
 * POST /api/postgres/people/[id]/cambio-cartera
 *
 * Cambia el `tipoCartera` del titular (anclado en la fila cuota#0 de
 * PAGOS_TITULARES). Body:
 *   {
 *     nuevoTipo: 'normal' | 'prejuridico' | 'ultimopago' | 'penalidad',
 *     motivo:    string (obligatorio)
 *   }
 *
 * Gate: `PERSON.FINANCIERA.CAMBIO_ESTADO_CARTERA` (SUPER_ADMIN / ADMIN bypass).
 * El cambio queda registrado en `PAGOS_TITULARES.cuota#0.tipoCarteraHistory`
 * (JSONB inmutable, sólo append) con motivo + estado anterior/nuevo + actor.
 */
export const POST = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, PersonPermission.CAMBIO_ESTADO_CARTERA);

  const body = await request.json().catch(() => ({}));
  const nuevoTipo = typeof body?.nuevoTipo === 'string' ? body.nuevoTipo : '';
  const motivo = typeof body?.motivo === 'string' ? body.motivo : '';
  if (!nuevoTipo) throw new ValidationError('nuevoTipo es requerido');
  if (!motivo?.trim()) throw new ValidationError('motivo es obligatorio');

  const actor = {
    email: ((session?.user as any)?.email || 'unknown').toString(),
    nombre: ((session?.user as any)?.name || null) as string | null,
  };

  const result = await pagosTitularesService.cambiarTipoCartera(
    params.id,
    { nuevoTipo, motivo },
    actor,
  );

  return successResponse(result);
});
