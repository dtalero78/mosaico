/**
 * API /api/admin/videos/sesiones
 *
 * GET  ?nivel=BN1  — Lista steps del nivel con videoUrl (DO Spaces) y video (YouTube/URL externo)
 * POST FormData: { nivel, step, file } — Sube MP4 a DO Spaces, actualiza NIVELES.videoUrl
 *      JSON:     { nivel, step, videoUrl?, video? } — Actualiza campos de video sin subir archivo
 * DELETE ?nivel=BN1&step=Step%201&field=videoUrl|video — Limpia campo y borra de Spaces si aplica
 */

import 'server-only'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth-postgres'
import { query, queryMany } from '@/lib/postgres'
import { spacesClient, SPACES_BUCKET } from '@/lib/spaces'
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

// ── helpers ──────────────────────────────────────────────────────────────────

async function requireAdmin(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  const role = (session.user as any).role
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') return null
  return session
}

function buildSpacesKey(nivel: string, step: string) {
  const safeStep = step.replace(/\s+/g, '-').toLowerCase()
  return `videos/sesiones/${nivel.toLowerCase()}/${safeStep}.mp4`
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const nivel = searchParams.get('nivel')
  if (!nivel) return NextResponse.json({ error: 'nivel es requerido' }, { status: 400 })

  // Select videoUrl + video (YouTube). The `video` column may be null if not set.
  const rows = await queryMany(
    `SELECT "_id", "code", "step", "description", "videoUrl",
            CASE WHEN column_name IS NOT NULL THEN "video" ELSE NULL END as "video"
     FROM "NIVELES"
     LEFT JOIN (
       SELECT column_name FROM information_schema.columns
       WHERE table_name='NIVELES' AND column_name='video' LIMIT 1
     ) cols ON true
     WHERE "code" = $1
     ORDER BY "orden" ASC NULLS LAST, "step" ASC`,
    [nivel]
  ).catch(async () => {
    // Fallback if information_schema JOIN causes issues
    return queryMany(
      `SELECT "_id", "code", "step", "description", "videoUrl"
       FROM "NIVELES" WHERE "code" = $1
       ORDER BY "orden" ASC NULLS LAST, "step" ASC`,
      [nivel]
    )
  })

  // Try to also fetch `video` column if it exists
  let withVideo = rows
  try {
    const rowsWithVideo = await queryMany(
      `SELECT "_id", "videoUrl", "video" FROM "NIVELES" WHERE "code" = $1 ORDER BY "orden" ASC NULLS LAST, "step" ASC`,
      [nivel]
    )
    withVideo = rows.map((r, i) => ({ ...r, video: (rowsWithVideo[i] as any)?.video ?? null }))
  } catch { /* video column may not exist */ }

  return NextResponse.json({ success: true, steps: withVideo })
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const session = await requireAdmin(request)
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const contentType = request.headers.get('content-type') || ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const nivel    = String(formData.get('nivel') || '')
      const step     = String(formData.get('step')  || '')
      const file     = formData.get('file') as File | null

      if (!nivel || !step || !file) {
        return NextResponse.json({ error: 'nivel, step y file son requeridos' }, { status: 400 })
      }

      const key    = buildSpacesKey(nivel, step)
      const buffer = Buffer.from(await file.arrayBuffer())

      await spacesClient.send(new PutObjectCommand({
        Bucket: SPACES_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: file.type || 'video/mp4',
        ACL: 'private',
      }))

      await query(
        `UPDATE "NIVELES" SET "videoUrl" = $1, "_updatedDate" = NOW()
         WHERE "code" = $2 AND "step" = $3`,
        [key, nivel, step]
      )

      return NextResponse.json({ success: true, videoUrl: key })
    }

    // JSON — update URL fields directly
    const body = await request.json()
    const { nivel, step, videoUrl, video } = body
    if (!nivel || !step) return NextResponse.json({ error: 'nivel y step son requeridos' }, { status: 400 })

    if (videoUrl !== undefined) {
      await query(
        `UPDATE "NIVELES" SET "videoUrl" = $1, "_updatedDate" = NOW() WHERE "code" = $2 AND "step" = $3`,
        [videoUrl || null, nivel, step]
      )
    }
    if (video !== undefined) {
      try {
        await query(
          `UPDATE "NIVELES" SET "video" = $1, "_updatedDate" = NOW() WHERE "code" = $2 AND "step" = $3`,
          [video || null, nivel, step]
        )
      } catch { /* video column may not exist */ }
    }

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('[admin/videos/sesiones POST]', e)
    return NextResponse.json({ error: e.message || 'Error al subir video' }, { status: 500 })
  }
}

// ── PATCH — confirm direct upload (presigned URL flow) ───────────────────────

export async function PATCH(request: Request) {
  try {
    const session = await requireAdmin(request)
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { nivel, step, key } = await request.json()
    if (!nivel || !step || !key) {
      return NextResponse.json({ error: 'nivel, step y key son requeridos' }, { status: 400 })
    }

    await query(
      `UPDATE "NIVELES" SET "videoUrl" = $1, "_updatedDate" = NOW()
       WHERE "code" = $2 AND "step" = $3`,
      [key, nivel, step]
    )

    return NextResponse.json({ success: true, videoUrl: key })
  } catch (e: any) {
    console.error('[admin/videos/sesiones PATCH]', e)
    return NextResponse.json({ error: e.message || 'Error al confirmar video' }, { status: 500 })
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(request: Request) {
  try {
    const session = await requireAdmin(request)
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const nivel = searchParams.get('nivel')
    const step  = searchParams.get('step')
    const field = searchParams.get('field') || 'videoUrl'

    if (!nivel || !step) return NextResponse.json({ error: 'nivel y step son requeridos' }, { status: 400 })

    if (field === 'videoUrl') {
      const rows = await queryMany<{ videoUrl: string | null }>(
        `SELECT "videoUrl" FROM "NIVELES" WHERE "code" = $1 AND "step" = $2`,
        [nivel, step]
      )
      const key = rows[0]?.videoUrl
      if (key) {
        try {
          await spacesClient.send(new DeleteObjectCommand({ Bucket: SPACES_BUCKET, Key: key }))
        } catch { /* ignore if already gone */ }
      }
      await query(
        `UPDATE "NIVELES" SET "videoUrl" = NULL, "_updatedDate" = NOW() WHERE "code" = $1 AND "step" = $2`,
        [nivel, step]
      )
    } else {
      try {
        await query(
          `UPDATE "NIVELES" SET "video" = NULL, "_updatedDate" = NOW() WHERE "code" = $1 AND "step" = $2`,
          [nivel, step]
        )
      } catch { /* video column may not exist */ }
    }

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('[admin/videos/sesiones DELETE]', e)
    return NextResponse.json({ error: e.message || 'Error al eliminar' }, { status: 500 })
  }
}
