/**
 * API /api/admin/videos/instructivos
 *
 * GET  — Lista los instructivos desde APP_CONFIG
 * POST — Sube video a DO Spaces + actualiza APP_CONFIG (FormData: file, id, title, description)
 *         OR solo actualiza metadatos si no hay archivo (JSON: id, title, description)
 * DELETE ?id=1 — Borra video de DO Spaces + limpia videoKey en APP_CONFIG
 * PATCH — Actualiza solo title/description (JSON: id, title, description)
 */

import 'server-only'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth-postgres'
import { query, queryOne } from '@/lib/postgres'
import { spacesClient, SPACES_BUCKET } from '@/lib/spaces'
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

const CONFIG_KEY = 'instructivos_config'

// Sin placeholders: cada instructivo se crea con su título propio ("Agregar
// Instructivo"). Así el nombre lo pone quien lo sube, no un "Instructivo N".
const DEFAULT_INSTRUCTIVOS: Instructivo[] = []

interface Instructivo {
  id: number
  title: string
  description: string
  videoKey: string | null   // DO Spaces key, e.g. "videos/instructivos/1.mp4"
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function requireAdmin(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  const role = (session.user as any).role
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') return null
  return session
}

async function ensureConfigTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS "APP_CONFIG" (
      "key"          VARCHAR(100) PRIMARY KEY,
      "value"        TEXT         NOT NULL DEFAULT '',
      "color"        VARCHAR(20)  NOT NULL DEFAULT '#ffffff',
      "updatedBy"    TEXT,
      "_updatedDate" TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `)
}

async function loadInstructivos(): Promise<Instructivo[]> {
  await ensureConfigTable()
  const row = await queryOne<{ value: string }>(
    `SELECT "value" FROM "APP_CONFIG" WHERE "key" = $1`,
    [CONFIG_KEY]
  )
  if (!row?.value) return DEFAULT_INSTRUCTIVOS
  try {
    const parsed = JSON.parse(row.value)
    return Array.isArray(parsed) ? parsed : DEFAULT_INSTRUCTIVOS
  } catch { return DEFAULT_INSTRUCTIVOS }
}

async function saveInstructivos(list: Instructivo[], updatedBy: string) {
  await ensureConfigTable()
  await query(
    `INSERT INTO "APP_CONFIG" ("key","value","color","updatedBy","_updatedDate")
     VALUES ($1,$2,'#ffffff',$3,NOW())
     ON CONFLICT ("key") DO UPDATE SET "value"=EXCLUDED."value","updatedBy"=EXCLUDED."updatedBy","_updatedDate"=NOW()`,
    [CONFIG_KEY, JSON.stringify(list), updatedBy]
  )
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const instructivos = await loadInstructivos()
  return NextResponse.json({ success: true, instructivos })
}

// ── POST (upload file OR update metadata) ─────────────────────────────────────

export async function POST(request: Request) {
  const session = await requireAdmin(request)
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const userEmail = (session.user as any).email ?? 'admin'

  const contentType = request.headers.get('content-type') || ''

  if (contentType.includes('multipart/form-data')) {
    // File upload
    const formData = await request.formData()
    const id       = Number(formData.get('id'))
    const title    = String(formData.get('title') || '')
    const desc     = String(formData.get('description') || '')
    const file     = formData.get('file') as File | null

    if (!id || !file) return NextResponse.json({ error: 'id y file son requeridos' }, { status: 400 })

    const key = `videos/instructivos/instructivo-${id}.mp4`
    const buffer = Buffer.from(await file.arrayBuffer())

    await spacesClient.send(new PutObjectCommand({
      Bucket: SPACES_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: file.type || 'video/mp4',
      ACL: 'private',
    }))

    const list = await loadInstructivos()
    const idx  = list.findIndex(i => i.id === id)
    if (idx >= 0) {
      list[idx] = { ...list[idx], title: title || list[idx].title, description: desc || list[idx].description, videoKey: key }
    } else {
      list.push({ id, title, description: desc, videoKey: key })
    }
    await saveInstructivos(list, userEmail)

    return NextResponse.json({ success: true, instructivo: list.find(i => i.id === id) })
  }

  // JSON — metadata only (or remove: true to delete the instructivo from the list)
  const body = await request.json()
  const { id, title, description, remove } = body
  if (!id) return NextResponse.json({ error: 'id es requerido' }, { status: 400 })

  const list = await loadInstructivos()
  const idx  = list.findIndex(i => i.id === id)

  // remove: true — delete entire instructivo from list
  if (remove) {
    const filtered = list.filter(i => i.id !== id)
    await saveInstructivos(filtered, userEmail)
    return NextResponse.json({ success: true })
  }

  if (idx >= 0) {
    if (title !== undefined)       list[idx].title       = title
    if (description !== undefined) list[idx].description = description
  } else {
    list.push({ id, title: title || `Instructivo ${id}`, description: description || '', videoKey: null })
  }
  await saveInstructivos(list, userEmail)
  return NextResponse.json({ success: true, instructivo: list.find(i => i.id === id) })
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(request: Request) {
  const session = await requireAdmin(request)
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const userEmail = (session.user as any).email ?? 'admin'

  const { searchParams } = new URL(request.url)
  const id = Number(searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id es requerido' }, { status: 400 })

  const list = await loadInstructivos()
  const item = list.find(i => i.id === id)

  if (item?.videoKey) {
    try {
      await spacesClient.send(new DeleteObjectCommand({ Bucket: SPACES_BUCKET, Key: item.videoKey }))
    } catch { /* ignore if not exists */ }
    item.videoKey = null
    await saveInstructivos(list, userEmail)
  }

  return NextResponse.json({ success: true })
}

// ── PATCH (title / description only) ─────────────────────────────────────────

export async function PATCH(request: Request) {
  const session = await requireAdmin(request)
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const userEmail = (session.user as any).email ?? 'admin'

  const body = await request.json()
  const { id, title, description } = body
  if (!id) return NextResponse.json({ error: 'id es requerido' }, { status: 400 })

  const list = await loadInstructivos()
  const idx  = list.findIndex(i => i.id === id)
  if (idx < 0) return NextResponse.json({ error: 'Instructivo no encontrado' }, { status: 404 })

  if (title !== undefined)       list[idx].title       = title
  if (description !== undefined) list[idx].description = description
  await saveInstructivos(list, userEmail)

  return NextResponse.json({ success: true, instructivo: list[idx] })
}
