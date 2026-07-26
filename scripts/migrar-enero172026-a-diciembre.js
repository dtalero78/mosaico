/**
 * migrar-enero172026-a-diciembre.js
 *
 * Migración de la campaña ENERO172026 (mosaico-db):
 *   1. Renombra ENERO172026 → ENERO262026 (los cursos SIN guía se quedan aquí).
 *   2. Crea la campaña DICIEMBRE012025 moviendo los cursos CON guía asignada.
 *   3. Para los cursos movidos: inicioCurso = 2025-12-01, finalCurso = inicio + (duración+1) meses,
 *      inicioCampania = 2025-12-01, finalCampaign = 2025-11-30.
 *   4. Regenera los eventos de CALENDARIO de TODOS los cursos afectados (endpoint
 *      /api/admin/regenerar-curso) para que reflejen el nuevo nombre/fechas.
 *
 * La campaña ENERO172026 está VACÍA (0 alumnos) → regenerar eventos es seguro.
 *
 * Uso:
 *   node scripts/migrar-enero172026-a-diciembre.js            (dry-run: muestra el plan)
 *   node scripts/migrar-enero172026-a-diciembre.js --apply    (aplica; requiere dev server en :3001)
 */
require('dotenv').config({ path: '.env.local' })
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const BASE = process.env.MIGRA_BASE || 'http://localhost:3001'
const ADMIN_EMAIL = 'admin@mosaico.com'
const ADMIN_PASSWORD = process.env.MIGRA_ADMIN_PASSWORD || 'tarelo5*'

const DIC_INICIO = '2025-12-01'
const DIC_CIERRE = '2025-11-30'  // finalCampaign (cierre matrícula) = inicio - 1 día

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
})

// ---- Login NextAuth (cookie jar) para llamar al endpoint de regeneración ----
async function loginAdmin() {
  const jar = {}
  const setJar = (res) => {
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : (res.headers.raw?.()['set-cookie'] || [])
    for (const c of sc) { const [kv] = c.split(';'); const [k, v] = kv.split('='); jar[k] = v }
  }
  const cookieHdr = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')

  let r = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: cookieHdr() } })
  setJar(r); const { csrfToken } = await r.json()

  r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookieHdr() },
    redirect: 'manual',
    body: new URLSearchParams({ csrfToken, email: ADMIN_EMAIL, password: ADMIN_PASSWORD, json: 'true' }),
  })
  setJar(r)
  r = await fetch(`${BASE}/api/auth/session`, { headers: { cookie: cookieHdr() } })
  const sess = await r.json()
  if (!sess?.user) throw new Error('Login admin falló: ' + JSON.stringify(sess))
  return cookieHdr()
}

;(async () => {
  console.log(`\n=== Migración ENERO172026 → ENERO262026 + DICIEMBRE012025 ${APPLY ? '(APLICAR)' : '(DRY-RUN)'} ===\n`)

  const cursos = (await pool.query(
    `SELECT "_id","tipoCurso","salon","guia","horarioCurso","duracionCurso",
            "inicioCurso"::text i, "finalCurso"::text f
       FROM "CURSOS_CAMPAIGN" WHERE "campaign"='ENERO172026'
      ORDER BY "tipoCurso","salon"`
  )).rows
  if (!cursos.length) { console.log('No hay cursos en ENERO172026 (¿ya migrados?). Nada que hacer.'); await pool.end(); return }

  const conGuia = cursos.filter(c => c.guia && String(c.guia).trim())
  const sinGuia = cursos.filter(c => !(c.guia && String(c.guia).trim()))

  // finalCurso de los movidos = 2025-12-01 + (duración+1) meses
  const addMonths = (iso, m) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString().slice(0, 10) }
  const finalDic = (c) => addMonths(DIC_INICIO, Number(c.duracionCurso) + 1)

  console.log(`ENERO262026 (renombre, se quedan ${sinGuia.length} sin guía):`)
  sinGuia.forEach(c => console.log(`   ${c.tipoCurso}/${c.salon}  inicio ${c.i}  final ${c.f}  (sin cambio de fechas)`))
  console.log(`\nDICIEMBRE012025 (se mueven ${conGuia.length} con guía; inicio ${DIC_INICIO}):`)
  conGuia.forEach(c => console.log(`   ${c.tipoCurso}/${c.salon}  dur ${c.duracionCurso}  ${c.i} → ${DIC_INICIO}   final ${c.f} → ${finalDic(c)}`))

  if (!APPLY) {
    console.log('\n(dry-run) No se escribió nada. Ejecuta con --apply para aplicar (dev server en :3001).')
    await pool.end(); return
  }

  // 1) Renombrar los SIN guía → ENERO262026
  if (sinGuia.length) {
    await pool.query(
      `UPDATE "CURSOS_CAMPAIGN" SET "campaign"='ENERO262026', "_updatedDate"=NOW()
        WHERE "_id" = ANY($1)`, [sinGuia.map(c => c._id)]
    )
  }
  // 2) Mover los CON guía → DICIEMBRE012025 con nuevas fechas (per-curso por su finalCurso)
  for (const c of conGuia) {
    await pool.query(
      `UPDATE "CURSOS_CAMPAIGN"
          SET "campaign"='DICIEMBRE012025',
              "inicioCampania"=$2::date, "finalCampaign"=$3::date,
              "inicioCurso"=$2::date, "finalCurso"=$4::date,
              "_updatedDate"=NOW()
        WHERE "_id"=$1`,
      [c._id, DIC_INICIO, DIC_CIERRE, finalDic(c)]
    )
  }
  console.log(`\n✔ CURSOS_CAMPAIGN actualizado: ${sinGuia.length} → ENERO262026, ${conGuia.length} → DICIEMBRE012025.`)

  // 3) Regenerar eventos de TODOS los cursos afectados (nuevo nombre/fechas)
  const allIds = cursos.map(c => c._id)
  console.log(`\nRegenerando eventos de ${allIds.length} cursos vía ${BASE}/api/admin/regenerar-curso ...`)
  const cookie = await loginAdmin()
  const rr = await fetch(`${BASE}/api/admin/regenerar-curso`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ cursoCampaignIds: allIds }),
  })
  const jr = await rr.json().catch(() => ({}))
  if (!rr.ok || jr?.success === false) { console.error('✖ Regeneración falló:', JSON.stringify(jr)); await pool.end(); process.exit(1) }
  console.log(`✔ Eventos regenerados: ${jr.regenerados}/${allIds.length} cursos, ${jr.totalEventos} eventos.`)
  if (jr.resultado?.some(x => x.error)) console.log('  ⚠ con errores:', JSON.stringify(jr.resultado.filter(x => x.error)))

  // Verificación
  const ver = (await pool.query(
    `SELECT "campaign", COUNT(*)::int cursos,
            MIN("inicioCurso")::text mini, MAX("finalCurso")::text maxf
       FROM "CURSOS_CAMPAIGN" WHERE "campaign" IN ('ENERO262026','DICIEMBRE012025','ENERO172026')
      GROUP BY "campaign" ORDER BY "campaign"`
  )).rows
  console.log('\nVerificación:')
  ver.forEach(v => console.log(`   ${v.campaign}: ${v.cursos} cursos  inicio ${v.mini}  finalMax ${v.maxf}`))
  await pool.end()
})().catch(e => { console.error(e); process.exit(1) })
