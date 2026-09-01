/**
 * Deja el rol SERVICIO_NIVELACIONES con los permisos que su nombre anuncia y
 * limpia los permisos huérfanos que quedaron en la base.
 *
 * Dos arreglos independientes, ambos idempotentes:
 *
 *  1. SERVICIO_NIVELACIONES tenía UN permiso, y era de otro módulo
 *     (MANTENIMIENTO.USUARIOS.ENVIO_MENSAJES). Sin SERVICIO.NIVELACIONES.VER el
 *     middleware ni siquiera lo dejaba abrir su propia pantalla.
 *
 *  2. Nueve permisos SERVICIO.EXAM_INTERN.* siguen guardados en tres roles pese
 *     a que el módulo de Exámenes Internacionales se eliminó del código. No dan
 *     acceso a nada (no existe la ruta ni el endpoint) pero inflan el conteo de
 *     la matriz, que es justo lo que hace dudar de si un rol está bien armado.
 *
 * Uso: node scripts/fix-permisos-nivelaciones-y-huerfanos.js [--apply]
 */
require('dotenv').config({ path: '.env.local' })
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const ROL = 'SERVICIO_NIVELACIONES'
const NIVELACIONES = [
  'SERVICIO.NIVELACIONES.VER',
  'SERVICIO.NIVELACIONES.GESTION',
  'SERVICIO.NIVELACIONES.EXPORTAR',
]
// Prefijo del módulo retirado; se borra de cualquier rol que lo conserve.
const HUERFANO = 'SERVICIO.EXAM_INTERN.'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/, ''),
  ssl: { rejectUnauthorized: false },
})

const leer = (v) => (Array.isArray(v) ? v : JSON.parse(v || '[]'))

;(async () => {
  console.log(APPLY ? '=== APLICANDO ===\n' : '=== ENSAYO (sin --apply no se escribe nada) ===\n')
  const { rows } = await pool.query(`SELECT "rol", "permisos" FROM "ROL_PERMISOS" ORDER BY "rol"`)

  const cambios = []
  for (const r of rows) {
    const antes = leer(r.permisos)
    let despues = antes.filter((p) => !p.startsWith(HUERFANO))
    const quitados = antes.length - despues.length

    let agregados = []
    if (r.rol === ROL) {
      agregados = NIVELACIONES.filter((p) => !despues.includes(p))
      despues = [...despues, ...agregados]
    }
    if (quitados || agregados.length) {
      cambios.push({ rol: r.rol, antes: antes.length, despues: despues.length, quitados, agregados, lista: despues })
    }
  }

  if (!cambios.length) {
    console.log('Nada que cambiar — ya está aplicado.')
    await pool.end()
    return
  }

  for (const c of cambios) {
    console.log(`${c.rol}: ${c.antes} → ${c.despues} permisos`)
    if (c.quitados) console.log(`   − ${c.quitados} huérfanos (${HUERFANO}*)`)
    c.agregados.forEach((p) => console.log(`   + ${p}`))
  }

  if (!APPLY) {
    console.log('\nEnsayo. Re-ejecuta con --apply para escribir.')
    await pool.end()
    return
  }

  for (const c of cambios) {
    await pool.query(
      `UPDATE "ROL_PERMISOS" SET "permisos" = $2::jsonb, "_updatedDate" = NOW(), "fechaActualizacion" = NOW() WHERE "rol" = $1`,
      [c.rol, JSON.stringify(c.lista)]
    )
  }

  // Verificación leyendo de vuelta, no confiando en el UPDATE.
  const ver = await pool.query(`SELECT "rol", "permisos" FROM "ROL_PERMISOS" ORDER BY "rol"`)
  const quedanHuerfanos = ver.rows.flatMap((r) => leer(r.permisos).filter((p) => p.startsWith(HUERFANO)))
  const rolNivel = leer(ver.rows.find((r) => r.rol === ROL)?.permisos)
  const faltan = NIVELACIONES.filter((p) => !rolNivel.includes(p))

  console.log(`\n--- verificación ---`)
  console.log(`huérfanos restantes: ${quedanHuerfanos.length}`)
  console.log(`${ROL}: ${rolNivel.length} permisos · faltan de nivelaciones: ${faltan.length ? faltan.join(', ') : 'ninguno'}`)
  console.log(quedanHuerfanos.length === 0 && faltan.length === 0 ? '\n✓ OK' : '\n✗ REVISAR')
  await pool.end()
})().catch((e) => { console.error(e.message); process.exit(1) })
