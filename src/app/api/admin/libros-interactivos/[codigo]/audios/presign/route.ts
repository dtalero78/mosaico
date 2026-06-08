/**
 * POST /api/admin/libros-interactivos/[codigo]/audios/presign
 *
 * Body: { pagina: number, contentType?: string }
 *
 * Devuelve una presigned PUT URL para que el admin suba el MP3 directo a
 * Spaces sin pasar por el server (evita 504 con archivos pesados). Después
 * el cliente debe llamar a POST /audios para registrar el audio en BD.
 *
 * Key resultante: materials/interactive/{codigo}/audio/page-NNN.mp3
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-postgres';
import { spacesClient, SPACES_BUCKET } from '@/lib/spaces';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';

export async function POST(
  request: Request,
  { params }: { params: { codigo: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 403 });
  }

  const codigo = String(params.codigo || '').toUpperCase().trim();
  const body = await request.json().catch(() => ({}));
  const pagina = Number(body?.pagina);
  const contentType = body?.contentType || 'audio/mpeg';

  if (!codigo) {
    return NextResponse.json({ success: false, error: 'codigo requerido' }, { status: 400 });
  }
  if (!Number.isInteger(pagina) || pagina < 1) {
    return NextResponse.json(
      { success: false, error: 'pagina debe ser entero >= 1' },
      { status: 400 }
    );
  }

  const relKey = `audio/page-${String(pagina).padStart(3, '0')}.mp3`;
  const fullKey = `materials/interactive/${codigo}/${relKey}`;

  const command = new PutObjectCommand({
    Bucket: SPACES_BUCKET,
    Key: fullKey,
    ContentType: contentType,
    ACL: 'private',
  });

  const presignedUrl = await getSignedUrl(spacesClient, command, { expiresIn: 600 });
  return NextResponse.json({
    success: true,
    presignedUrl,
    key: relKey,    // ← lo que el cliente debe enviar al endpoint POST /audios
    fullKey,         // informativo
  });
}
