import { NextResponse } from 'next/server';
import { handlerWithAuth } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AprobacionPermission } from '@/types/permissions';
import { zipDeContrato } from '@/services/libro-depuracion.service';

/** GET — ZIP `<contrato>_<fecha>.zip` con documentos, recibo y PDF del contrato. */
export const GET = handlerWithAuth(async (_req, ctx, session) => {
  await requirePermission(session, AprobacionPermission.LIBRO_PRODUCCION_DEPURAR);
  const { buffer, nombre } = await zipDeContrato(ctx.params.titularId);
  return new NextResponse(buffer as any, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    },
  });
});
