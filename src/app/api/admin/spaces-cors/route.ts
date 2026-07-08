import 'server-only'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth-postgres'
import { spacesClient, SPACES_BUCKET } from '@/lib/spaces'
import { PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3'

/**
 * POST /api/admin/spaces-cors
 * Applies CORS policy to DO Spaces bucket to allow presigned PUT uploads
 * from the production domain and localhost (dev).
 * SUPER_ADMIN only — one-time setup.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any).role
  if (role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await spacesClient.send(new PutBucketCorsCommand({
    Bucket: SPACES_BUCKET,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: [
            'https://mosaicosorobanplataforma.com',
            'https://www.mosaicosorobanplataforma.com',
            'https://mosaico-sy8tq.ondigitalocean.app',
            'http://localhost:3002',
            'http://localhost:3001',
            'http://localhost:3000',
          ],
          AllowedMethods: ['GET', 'PUT', 'DELETE', 'HEAD'],
          AllowedHeaders: ['*'],
          ExposeHeaders: ['ETag', 'Content-Length'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }))

  return NextResponse.json({ success: true, message: 'CORS configurado correctamente en DO Spaces' })
}

/**
 * GET /api/admin/spaces-cors
 * Returns current CORS configuration on the bucket.
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any).role
  if (role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const result = await spacesClient.send(new GetBucketCorsCommand({ Bucket: SPACES_BUCKET }))
    return NextResponse.json({ success: true, corsRules: result.CORSRules })
  } catch {
    return NextResponse.json({ success: true, corsRules: [], message: 'Sin configuración CORS actual' })
  }
}
