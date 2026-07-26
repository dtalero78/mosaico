/**
 * MOSAICO — "Movimiento Académico" (reemplaza "Cambiar Step" de LGS).
 *
 * 1) ACADEMICA_BOOKINGS += "movimientoAcademico" BOOLEAN DEFAULT false — marca los
 *    bookings aprobados por un Movimiento Académico (para el badge en ¿Cómo voy?).
 * 2) ROL_PERMISOS: a cada rol que tenga STUDENT.ACADEMIA.ASIGNAR_STEP ("Cambiar Step",
 *    heredado de LGS y ya muerto) se le AGREGA STUDENT.ACADEMIA.MOVIMIENTO_ACADEMICO
 *    (para no perder acceso) y se le QUITA ASIGNAR_STEP.
 *
 * Idempotente. Uso:
 *   node scripts/migrar-movimiento-academico.js            # dry-run
 *   node scripts/migrar-movimiento-academico.js --apply
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
const OLD = 'STUDENT.ACADEMIA.ASIGNAR_STEP';
const NEW = 'STUDENT.ACADEMIA.MOVIMIENTO_ACADEMICO';
const pool = new Pool({ connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });

(async () => {
  console.log(`\n══ Movimiento Académico (${APPLY ? 'APPLY' : 'DRY-RUN'}) ══\n`);

  // 1) Columna marcador en bookings
  const colExists = (await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='ACADEMICA_BOOKINGS' AND column_name='movimientoAcademico'`
  )).rows.length > 0;
  console.log(`1) ACADEMICA_BOOKINGS."movimientoAcademico": ${colExists ? 'ya existe' : 'FALTA'}`);
  if (!colExists && APPLY) {
    await pool.query(`ALTER TABLE "ACADEMICA_BOOKINGS" ADD COLUMN IF NOT EXISTS "movimientoAcademico" BOOLEAN DEFAULT false`);
    console.log('   → columna creada');
  }

  // 2) Permisos por rol
  const roles = (await pool.query(`SELECT "_id","rol","permisos" FROM "ROL_PERMISOS"`)).rows;
  const conAsignar = roles.filter(r => {
    const p = Array.isArray(r.permisos) ? r.permisos : (() => { try { return JSON.parse(r.permisos); } catch { return []; } })();
    return p.includes(OLD);
  });
  console.log(`\n2) Roles con ASIGNAR_STEP ("Cambiar Step"): ${conAsignar.length ? conAsignar.map(r => r.rol).join(', ') : '(ninguno)'}`);
  console.log(`   → a cada uno se le agrega MOVIMIENTO_ACADEMICO y se le quita ASIGNAR_STEP.`);

  if (APPLY) {
    for (const r of conAsignar) {
      let p = Array.isArray(r.permisos) ? r.permisos : JSON.parse(r.permisos || '[]');
      p = p.filter(x => x !== OLD);
      if (!p.includes(NEW)) p.push(NEW);
      await pool.query(`UPDATE "ROL_PERMISOS" SET "permisos"=$2::jsonb, "_updatedDate"=NOW() WHERE "_id"=$1`, [r._id, JSON.stringify(p)]);
      console.log(`   ✓ ${r.rol}`);
    }
    // Barrido defensivo: quitar ASIGNAR_STEP de CUALQUIER rol que aún lo tenga (por si acaso)
    await pool.query(
      `UPDATE "ROL_PERMISOS" SET "permisos" = (SELECT jsonb_agg(x) FROM jsonb_array_elements("permisos") x WHERE x::text <> $1), "_updatedDate"=NOW()
       WHERE "permisos" @> $2::jsonb`,
      [JSON.stringify(OLD), JSON.stringify([OLD])]
    );
  }

  // Verificación
  if (APPLY) {
    const restantes = (await pool.query(`SELECT COUNT(*)::int n FROM "ROL_PERMISOS" WHERE "permisos" @> $1::jsonb`, [JSON.stringify([OLD])])).rows[0].n;
    const conNuevo = (await pool.query(`SELECT COUNT(*)::int n FROM "ROL_PERMISOS" WHERE "permisos" @> $1::jsonb`, [JSON.stringify([NEW])])).rows[0].n;
    console.log(`\nVerificación → roles con ASIGNAR_STEP restantes: ${restantes} (debe ser 0) · roles con MOVIMIENTO_ACADEMICO: ${conNuevo}`);
  } else {
    console.log('\n(dry-run — nada escrito. Agrega --apply.)');
  }
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
