import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError, ForbiddenError } from '@/lib/errors';
import { query } from '@/lib/postgres';
import { generateId } from '@/lib/id-generator';
import { getCierre } from '@/services/reporte-academico.service';

/**
 * POST /api/postgres/reports/academico/reporte-academico/cerrar
 * Body: { curso, salon, campaign, semanaInicio, accion: 'GUIA' | 'DEFINITIVO' }
 *
 * Cierra el informe semanal de un SALÓN (el cierre es por salón, no por alumno):
 *   accion='GUIA'       → BORRADOR ⇒ CERRADO_GUIA. El Guía ya no puede modificarlo.
 *   accion='DEFINITIVO' → CERRADO_GUIA ⇒ DEFINITIVO. Requiere el permiso
 *                         ACADEMICO.REPORTE_ACADEMICO.REVISAR; después sólo
 *                         SUPER_ADMIN puede tocar el informe.
 *
 * Las transiciones se validan contra el estado REAL en base de datos, no contra lo
 * que mande el cliente.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.REPORTE_ACADEMICO_VER);

  const b = await request.json().catch(() => ({}));
  const curso = String(b?.curso || '').trim();
  const salon = String(b?.salon || '').trim();
  const campaign = String(b?.campaign || '').trim();
  const semanaInicio = String(b?.semanaInicio || '').trim();
  const accion = String(b?.accion || '').trim().toUpperCase();

  if (!curso || !salon || !campaign || !semanaInicio) {
    throw new ValidationError('Falta curso, salón, campaña o semana.');
  }
  if (accion !== 'GUIA' && accion !== 'DEFINITIVO') {
    throw new ValidationError('Acción no válida.');
  }

  const email = (session as any)?.user?.email || 'desconocido';
  const rol = String((session as any)?.user?.role || '');
  const { estado } = await getCierre(curso, salon, campaign, semanaInicio);

  if (estado === 'DEFINITIVO' && rol !== 'SUPER_ADMIN') {
    throw new ForbiddenError('El informe ya tiene cierre definitivo.');
  }

  if (accion === 'GUIA') {
    // El estado sólo avanza: BORRADOR → CERRADO_GUIA → DEFINITIVO. Sin esta guarda,
    // un SUPER_ADMIN podía reenviar la acción y DEGRADAR un informe ya definitivo.
    if (estado !== 'BORRADOR') {
      throw new ValidationError(
        estado === 'DEFINITIVO'
          ? 'El informe ya tiene cierre definitivo.'
          : 'El informe ya fue cerrado por el Guía.'
      );
    }
    await query(
      `INSERT INTO "REPORTE_ACADEMICO_CIERRE"
         ("_id","curso","salon","campaign","semanaInicio","estado","cerradoGuiaPor","cerradoGuiaEn")
       VALUES ($1,$2,$3,$4,$5,'CERRADO_GUIA',$6,NOW())
       ON CONFLICT ("curso","salon","campaign","semanaInicio") DO UPDATE SET
         "estado" = 'CERRADO_GUIA',
         "cerradoGuiaPor" = EXCLUDED."cerradoGuiaPor",
         "cerradoGuiaEn"  = NOW(),
         "_updatedDate"   = NOW()`,
      [generateId('rac'), curso, salon, campaign, semanaInicio, email]
    );
    return successResponse({ ok: true, estado: 'CERRADO_GUIA' });
  }

  // DEFINITIVO — sólo quien revisa (requirePermission deja pasar a SUPER_ADMIN/ADMIN).
  await requirePermission(session, AcademicoPermission.REPORTE_ACADEMICO_REVISAR);
  if (estado === 'BORRADOR') {
    throw new ValidationError('El informe aún no ha sido cerrado por el Guía.');
  }
  await query(
    `INSERT INTO "REPORTE_ACADEMICO_CIERRE"
       ("_id","curso","salon","campaign","semanaInicio","estado","cerradoAdminPor","cerradoAdminEn")
     VALUES ($1,$2,$3,$4,$5,'DEFINITIVO',$6,NOW())
     ON CONFLICT ("curso","salon","campaign","semanaInicio") DO UPDATE SET
       "estado" = 'DEFINITIVO',
       "cerradoAdminPor" = EXCLUDED."cerradoAdminPor",
       "cerradoAdminEn"  = NOW(),
       "_updatedDate"    = NOW()`,
    [generateId('rac'), curso, salon, campaign, semanaInicio, email]
  );
  return successResponse({ ok: true, estado: 'DEFINITIVO' });
});
