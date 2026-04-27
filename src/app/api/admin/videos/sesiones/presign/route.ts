import 'server-only'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth-postgres'
import { spacesClient, SPACES_BUCKET } from '@/lib/spaces'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/**
 * POST /api/admin/videos/sesiones/presign
 *
 * Returns a presigned PUT URL so the client can upload the video
 * directly to DO Spaces without routing through the server.
 * Avoids 504 Gateway Timeout on large video files.
 *
 * Body JSON: { nivel, step, contentType }
 * Response:  { presignedUrl, key }
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any).role
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { nivel, step, contentType } = await request.json()
  if (!nivel || !step) {
    return NextResponse.json({ error: 'nivel y step son requeridos' }, { status: 400 })
  }

  const safeStep = String(step).replace(/\s+/g, '-').toLowerCase()
  const key = `videos/sesiones/${String(nivel).toLowerCase()}/${safeStep}.mp4`

  const command = new PutObjectCommand({
    Bucket: SPACES_BUCKET,
    Key: key,
    ContentType: contentType || 'video/mp4',
    ACL: 'private',
  })

  const presignedUrl = await getSignedUrl(spacesClient, command, { expiresIn: 600 })

  return NextResponse.json({ success: true, presignedUrl, key })
}
