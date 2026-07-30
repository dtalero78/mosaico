import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-postgres';
import { spacesClient, SPACES_BUCKET } from '@/lib/spaces';
import { GetObjectCommand } from '@aws-sdk/client-s3';

/**
 * GET /api/postgres/cursos-contenido/imagen?key=evaluaciones/...
 *
 * Streamea una imagen de evaluación desde DO Spaces (proxy estable para embeber
 * en `![](url)`). Requiere sesión (el <img> mismo-origen manda la cookie).
 * Restringido al prefijo `evaluaciones/`.
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');
  if (!key || !key.startsWith('evaluaciones/')) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
  }

  try {
    const s3Response = await spacesClient.send(new GetObjectCommand({ Bucket: SPACES_BUCKET, Key: key }));
    const headers: Record<string, string> = {
      'Content-Type': s3Response.ContentType || 'image/png',
      'Cache-Control': 'private, max-age=86400',
    };
    if (s3Response.ContentLength) headers['Content-Length'] = String(s3Response.ContentLength);
    return new NextResponse(s3Response.Body as ReadableStream, { status: 200, headers });
  } catch {
    return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  }
}
