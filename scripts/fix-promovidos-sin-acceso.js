/**
 * Deja operativos a los beneficiarios APROBADOS y ya promovidos a su curso real
 * que aún no pueden entrar a la plataforma.
 *
 * Causa: promover desde WELCOME no activaba al alumno (se corrigió en
 * `promoteFromWelcome`), y el cron `activate-academica` sólo actúa ≤10 días antes
 * de `ACADEMICA.inicioCurso` — nunca toma a quien tenga ese campo en NULL. Así
 * quedaban alumnos aprobados, con su curso incluso ya empezado, sin acceso.
 *
 * Qué repara, por alumno:
 *   - ACADEMICA."estadoInactivo" = false
 *   - USUARIOS_ROLES."activo" = true   (cuenta resuelta por userLogin → numberid)
 *
 * NO repara (los reporta para revisión manual):
 *   - Alumnos SIN cuenta en USUARIOS_ROLES: crear un login es otra decisión.
 *   - Alumnos en OnHold o con el contrato vencido: su bloqueo es legítimo.
 *
 * Uso: node scripts/fix-promovidos-sin-acceso.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows } = await pool.query(
    `SELECT a."_id" AS "academicaId", a."numeroId", a."userLogin",
            TRIM(CONCAT_WS(' ', a."primerNombre", a."primerApellido")) AS nombre,
            a."curso", a."estadoInactivo" AS acad_inactiva, a."inicioCurso"::text AS inicio,
            u."_id" AS "usuarioRolId", u."activo" AS login_activo,
            p."fechaOnHold", p."finalContrato"::text AS "finalContrato",
            p."estadoInactivo" AS people_inactivo
       FROM "ACADEMICA" a
       JOIN "PEOPLE" p ON p."numeroId" = a."numeroId" AND p."tipoUsuario" = 'BENEFICIARIO'
       LEFT JOIN "USUARIOS_ROLES" u
         ON (COALESCE(a."userLogin",'') <> '' AND u."userLogin" = a."userLogin")
         OR (COALESCE(a."userLogin",'') = '' AND UPPER(TRIM(u."numberid")) = UPPER(TRIM(a."numeroId")) AND u."rol" = 'ESTUDIANTE')
      WHERE LOWER(COALESCE(p."aprobacion", '')) IN ('aprobado', 'aprobada')
        AND COALESCE(a."curso", '') NOT IN ('WELCOME', '')
        AND (a."estadoInactivo" IS TRUE OR u."activo" IS NOT TRUE)
        AND COALESCE(p."contrato", '') NOT LIKE 'PRB-%'
      ORDER BY nombre`
  );

  const hoy = new Date();
  const vencido = (f) => {
    if (!f) return false;
    const d = new Date(f + 'T00:00:00Z');
    return (hoy.getTime() - d.getTime()) / 86400000 >= 2; // misma gracia que contract-expiry
  };

  const reparables = [], manuales = [];
  for (const r of rows) {
    if (!r.usuarioRolId) { manuales.push({ ...r, motivo: 'SIN cuenta de login' }); continue; }
    if (r.fechaOnHold) { manuales.push({ ...r, motivo: 'en OnHold (bloqueo legítimo)' }); continue; }
    if (vencido(r.finalContrato)) { manuales.push({ ...r, motivo: `contrato vencido (${r.finalContrato})` }); continue; }
    reparables.push(r);
  }

  console.log(`\nAprobados y promovidos que hoy NO pueden entrar: ${rows.length}\n`);
  if (reparables.length) {
    console.log(`── Se pueden dejar operativos: ${reparables.length}`);
    console.table(reparables.map(r => ({
      nombre: r.nombre, curso: r.curso, userLogin: r.userLogin,
      acad_inactiva: r.acad_inactiva, login_activo: r.login_activo,
      inicioCurso: r.inicio || '(null)',
    })));
  }
  if (manuales.length) {
    console.log(`\n── Requieren decisión manual: ${manuales.length}`);
    console.table(manuales.map(r => ({
      nombre: r.nombre, curso: r.curso, motivo: r.motivo,
      userLogin: r.userLogin || '(sin userLogin)',
    })));
  }

  if (!APPLY) {
    console.log('\n(dry-run — no se escribió nada. Reejecuta con --apply.)');
    await pool.end();
    return;
  }

  let ok = 0;
  for (const r of reparables) {
    try {
      await pool.query(`UPDATE "ACADEMICA" SET "estadoInactivo" = false, "_updatedDate" = NOW() WHERE "_id" = $1`, [r.academicaId]);
      await pool.query(`UPDATE "USUARIOS_ROLES" SET "activo" = true, "_updatedDate" = NOW() WHERE "_id" = $1`, [r.usuarioRolId]);
      ok++;
      console.log(`✅ ${r.nombre} — operativo (${r.userLogin})`);
    } catch (e) {
      console.error(`❌ ${r.nombre}: ${e.message}`);
    }
  }
  console.log(`\nListo: ${ok}/${reparables.length} dejados operativos. ${manuales.length} para revisión manual.`);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
