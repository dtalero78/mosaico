/**
 * Restaura ACADEMICA.estadoInactivo=false y USUARIOS_ROLES.activo=true para
 * los beneficiarios afectados por el efecto colateral del bulk-bloqueo
 * (mismo numeroId/email que un titular bloqueado).
 *
 * Lee `bloqueo-side-effects.csv` generado por inspect-bloqueo-side-effects.js.
 * NO toca PEOPLE (ya está correcto).
 *
 * Modos:
 *   node scripts/fix-bloqueo-side-effects.js           → dry-run
 *   node scripts/fix-bloqueo-side-effects.js --apply   → ejecuta
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const INPUT = path.join(process.cwd(), 'bloqueo-side-effects.csv');

function readCsv(filepath, sep = ';') {
  let raw = fs.readFileSync(filepath, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
  const header = lines[0].split(sep);
  return lines.slice(1).map(line => {
    const cols = line.split(sep);
    const obj = {};
    header.forEach((h, i) => { obj[h.trim()] = (cols[i] ?? '').trim(); });
    return obj;
  });
}

(async () => {
  if (!fs.existsSync(INPUT)) {
    console.error(`No existe ${INPUT}. Corre primero scripts/inspect-bloqueo-side-effects.js`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    console.log(`Modo: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

    const rows = readCsv(INPUT);
    console.log(`Casos a procesar: ${rows.length}\n`);

    let academicaRestauradas = 0;
    let usuariosRestaurados = 0;
    let errores = 0;

    for (const r of rows) {
      try {
        // Verificación de seguridad: PEOPLE BENEFICIARIO debe seguir activo
        const benefCheck = await pool.query(
          `SELECT "estadoInactivo" FROM "PEOPLE" WHERE "_id" = $1`,
          [r.people_id_benef]
        );
        if (benefCheck.rowCount === 0 || benefCheck.rows[0].estadoInactivo === true) {
          console.log(`  ⚠️  SKIP ${r.nombre} — PEOPLE BENEFICIARIO ya inactivo o no existe`);
          continue;
        }

        // Restaurar ACADEMICA por numeroId si el flag indica que está inactiva
        if (r.academica_inactiva === 'SI' && r.numeroId) {
          if (APPLY) {
            const upd = await pool.query(
              `UPDATE "ACADEMICA" SET "estadoInactivo" = false, "_updatedDate" = NOW()
               WHERE "numeroId" = $1 AND "estadoInactivo" = true`,
              [r.numeroId]
            );
            if ((upd.rowCount ?? 0) > 0) academicaRestauradas++;
          } else {
            academicaRestauradas++;
          }
        }

        // Restaurar USUARIOS_ROLES por email
        if (r.usuario_bloqueado === 'SI' && r.email) {
          if (APPLY) {
            const upd = await pool.query(
              `UPDATE "USUARIOS_ROLES" SET "activo" = true, "_updatedDate" = NOW()
               WHERE LOWER("email") = LOWER($1) AND "activo" = false`,
              [r.email]
            );
            if ((upd.rowCount ?? 0) > 0) usuariosRestaurados++;
          } else {
            usuariosRestaurados++;
          }
        }
      } catch (err) {
        errores++;
        console.error(`  ❌ ERROR ${r.nombre} (${r.numeroId}):`, err.message);
      }
    }

    console.log('\n=== RESUMEN ===');
    console.log(`ACADEMICA restauradas${APPLY ? '' : ' (a restaurar)'}:    ${academicaRestauradas}`);
    console.log(`USUARIOS_ROLES restaurados${APPLY ? '' : ' (a restaurar)'}: ${usuariosRestaurados}`);
    console.log(`Errores:                              ${errores}`);

    if (!APPLY) {
      console.log(`\nDry-run. Para aplicar:\n  node scripts/fix-bloqueo-side-effects.js --apply`);
    }
  } catch (e) {
    console.error('ERROR:', e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
