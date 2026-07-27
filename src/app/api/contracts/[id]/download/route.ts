/**
 * GET /api/contracts/[id]/download   [id] = PEOPLE._id del titular
 *
 * Descarga el PDF del contrato desde el Drive PROPIO de MOSAICO (carpeta CONTRATOS
 * MOS), buscándolo por su nombre canónico `MOS_<contrato>.pdf` (buildContractFileBase).
 * Reemplaza el botón viejo que pegaba a bsl-utilidades (`?empresa=LGS`) con el titularId,
 * que ya no encuentra el archivo porque ahora vive en el Drive de MOSAICO con otro nombre.
 *
 * Si el Drive propio no está configurado o el archivo no está ahí, cae al flujo legacy
 * de bsl-utilidades (Drive de LGS) como respaldo.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { handlerWithAuth } from '@/lib/api-helpers';
import { NotFoundError } from '@/lib/errors';
import { queryOne } from '@/lib/postgres';
import { isDriveConfigured, downloadPdfFromDrive } from '@/lib/gdrive';
import { buildContractFileBase } from '@/lib/contract-pdf';

const BSL_DOWNLOAD = 'https://bsl-utilidades-yp78a.ondigitalocean.app/descargar-pdf-drive';

export const GET = handlerWithAuth(async (_req, { params }, _session) => {
  const titular = await queryOne<{ contrato: string | null }>(
    `SELECT "contrato" FROM "PEOPLE" WHERE "_id" = $1`,
    [params.id],
  );
  if (!titular) throw new NotFoundError('Titular', params.id);

  const fileName = `${buildContractFileBase(titular.contrato || '', params.id)}.pdf`;

  if (isDriveConfigured()) {
    const file = await downloadPdfFromDrive(fileName);
    if (file) {
      return new NextResponse(file.buffer as any, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Length': String(file.buffer.length),
          'Cache-Control': 'no-store',
        },
      });
    }
  }

  // Respaldo: Drive de LGS vía bsl-utilidades (contratos viejos aún no en el Drive propio).
  return NextResponse.redirect(`${BSL_DOWNLOAD}/${params.id}?empresa=LGS`, 302);
});
