import 'server-only'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth-postgres'
import { query, queryMany, queryOne } from '@/lib/postgres'
import { spacesClient, SPACES_BUCKET } from '@/lib/spaces'
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { generateId } from '@/lib/id-generator'

// ── Audit table (created once on first use) ──────────────────────────────────
let auditTableReady = false
async function ensureAuditTable() {
  if (auditTableReady) return
  await query(`
    CREATE TABLE IF NOT EXISTS "MATERIAL_AUDIT" (
      "_id"             TEXT PRIMARY KEY,
      "tipo"            TEXT NOT NULL,
      "nivel"           TEXT NOT NULL,
      "step"            TEXT NOT NULL,
      "accion"          TEXT NOT NULL,
      "archivoAnterior" TEXT,
      "archivoNuevo"    TEXT,
      "realizadoPor"    TEXT NOT NULL,
      "_createdDate"    TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  auditTableReady = true
}

async function logAudit(data: {
  tipo: string; nivel: string; step: string; accion: string
  archivoAnterior?: string | null; archivoNuevo?: string | null; realizadoPor: string
}) {
  await ensureAuditTable()
  await query(
    `INSERT INTO "MATERIAL_AUDIT"
       ("_id","tipo","nivel","step","accion","archivoAnterior","archivoNuevo","realizadoPor","_createdDate")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
    [
      generateId('mat'),
      data.tipo, data.nivel, data.step, data.accion,
      data.archivoAnterior ?? null,
      data.archivoNuevo   ?? null,
      data.realizadoPor,
    ]
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalise the raw JSONB field into a list of {key, name} entries */
function parseFiles(raw: unknown, tipo: string): { key: string; name: string }[] {
  if (!Array.isArray(raw)) return []
  if (tipo === 'usuario') {
    return (raw as unknown[])
      .filter((k): k is string => typeof k === 'string' && k.startsWith('materials/'))
      .map(k => ({ key: k, name: decodeURIComponent(k.split('/').pop() ?? k) }))
  }
  // advisor: [{name, url}] or plain strings
  return (raw as unknown[])
    .map(m => {
      const url = typeof m === 'string' ? m : ((m as any)?.url ?? '')
      const name = typeof m === 'string'
        ? decodeURIComponent(url.split('/').pop() ?? url)
        : ((m as any)?.name ?? (m as any)?.nombre ?? decodeURIComponent(url.split('/').pop() ?? url))
      return { key: url, name }
    })
    .filter(f => f.key)
}

/** Rebuild the JSONB value after mutation */
function rebuildField(files: { key: string; name: string }[], tipo: string) {
  if (tipo === 'usuario') return JSON.stringify(files.map(f => f.key))
  return JSON.stringify(files.map(f => ({ name: f.name, url: f.key })))
}

// ── GET /api/postgres/materials/manage?nivel=BN1&tipo=usuario ─────────────────
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const nivel = searchParams.get('nivel')
  const tipo  = searchParams.get('tipo')    // 'usuario' | 'advisor'
  const curso = searchParams.get('curso')   // MOSAICO: el code (módulo) se repite entre cursos
  if (!nivel || !tipo) return NextResponse.json({ error: 'nivel and tipo requeridos' }, { status: 400 })

  const field = tipo === 'usuario' ? 'materialUsuario' : 'material'
  const rows = await queryMany(
    `SELECT "_id", "code", "step", "${field}", "orden"
     FROM "NIVELES"
     WHERE "code" = $1 AND ($2::text IS NULL OR "curso" = $2)
     ORDER BY "orden" ASC NULLS LAST, "step" ASC`,
    [nivel, curso || null]
  )

  const steps = rows.map(row => ({
    _id:   row._id,
    step:  row.step,
    files: parseFiles(row[field], tipo),
  }))

  return NextResponse.json({ success: true, steps })
}

// ── POST /api/postgres/materials/manage  (FormData: nivel,step,stepId,tipo,file,[archivoAnterior]) ──
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form     = await req.formData()
  const nivel    = form.get('nivel')    as string
  const step     = form.get('step')     as string
  const stepId   = form.get('stepId')   as string
  const tipo     = form.get('tipo')     as string
  const curso    = (form.get('curso')   as string | null) || null
  const file     = form.get('file')     as File
  const anterior = (form.get('archivoAnterior') as string | null) || null

  if (!nivel || !step || !stepId || !tipo || !file?.size) {
    return NextResponse.json({ error: 'Faltan parámetros requeridos' }, { status: 400 })
  }

  // Build Spaces key: materials/[<curso>/]<nivel>/<tipo>/<sanitizedStep>-<filename>
  // El curso se incluye porque en MOSAICO el code (módulo) se repite entre cursos
  // → evita colisión de archivos entre cursos con el mismo módulo/lección.
  const safeStep  = step.replace(/[^a-zA-Z0-9\-]/g, '-')
  const safeName  = file.name.replace(/[^a-zA-Z0-9._\-]/g, '_')
  const safeCurso = curso ? curso.replace(/[^a-zA-Z0-9\-]/g, '-') : ''
  const key       = `materials/${safeCurso ? `${safeCurso}/` : ''}${nivel}/${tipo}/${safeStep}-${safeName}`

  // Upload to DO Spaces
  const buffer = Buffer.from(await file.arrayBuffer())
  await spacesClient.send(new PutObjectCommand({
    Bucket:      SPACES_BUCKET,
    Key:         key,
    Body:        buffer,
    ContentType: file.type || 'application/pdf',
    ACL:         'private',
  }))

  // Update NIVELES
  const field = tipo === 'usuario' ? 'materialUsuario' : 'material'
  const row   = await queryOne(`SELECT "${field}" FROM "NIVELES" WHERE "_id" = $1`, [stepId])
  let files   = parseFiles(row?.[field], tipo)

  // Remove previous entry when replacing
  if (anterior) files = files.filter(f => f.key !== anterior)

  const newName = file.name.replace(/\.pdf$/i, '')
  files.push({ key, name: newName })

  await query(
    `UPDATE "NIVELES" SET "${field}" = $1::jsonb, "_updatedDate" = NOW() WHERE "_id" = $2`,
    [rebuildField(files, tipo), stepId]
  )

  await logAudit({
    tipo, nivel, step,
    accion: anterior ? 'reemplazar' : 'agregar',
    archivoAnterior: anterior,
    archivoNuevo: key,
    realizadoPor: session.user.email ?? 'desconocido',
  })

  return NextResponse.json({ success: true, key, message: 'Material actualizado correctamente' })
}

// ── DELETE /api/postgres/materials/manage  (JSON: stepId,tipo,nivel,step,fileKey) ──
export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { stepId, tipo, nivel, step, fileKey } = await req.json()
  if (!stepId || !tipo || !nivel || !step || !fileKey) {
    return NextResponse.json({ error: 'Faltan parámetros requeridos' }, { status: 400 })
  }

  const field = tipo === 'usuario' ? 'materialUsuario' : 'material'
  const row   = await queryOne(`SELECT "${field}" FROM "NIVELES" WHERE "_id" = $1`, [stepId])
  let files   = parseFiles(row?.[field], tipo)

  files = files.filter(f => f.key !== fileKey)

  await query(
    `UPDATE "NIVELES" SET "${field}" = $1::jsonb, "_updatedDate" = NOW() WHERE "_id" = $2`,
    [rebuildField(files, tipo), stepId]
  )

  // Also remove from Spaces if it is a managed key (starts with materials/)
  if (fileKey.startsWith('materials/')) {
    try {
      await spacesClient.send(new DeleteObjectCommand({ Bucket: SPACES_BUCKET, Key: fileKey }))
    } catch {
      // Non-fatal: key may not exist in Spaces
    }
  }

  await logAudit({
    tipo, nivel, step,
    accion: 'borrar',
    archivoAnterior: fileKey,
    realizadoPor: session.user.email ?? 'desconocido',
  })

  return NextResponse.json({ success: true, message: 'Material eliminado correctamente' })
}

// ── PATCH /api/postgres/materials/manage  (JSON: tipo,nivel,step,fileKey — log descarga) ──
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tipo, nivel, step, fileKey } = await req.json()
  if (!tipo || !nivel || !step || !fileKey) {
    return NextResponse.json({ error: 'Faltan parámetros requeridos' }, { status: 400 })
  }

  await logAudit({
    tipo, nivel, step,
    accion: 'descargar',
    archivoAnterior: fileKey,
    realizadoPor: session.user.email ?? 'desconocido',
  })

  return NextResponse.json({ success: true })
}
