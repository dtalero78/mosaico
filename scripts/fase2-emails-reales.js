/**
 * MOSAICO — Fase 2 (paso de DATOS): elimina el workaround del email sintético.
 *
 * Contexto: hasta Fase 1, cuando dos hermanos compartían el email del apoderado,
 * al 2º+ se le ponía un email sintético `<userLogin>@est.mosaico.cl` en
 * USUARIOS_ROLES (y se alineaba ACADEMICA.email) porque `USUARIOS_ROLES.email`
 * era UNIQUE. Con Fase 2 la IDENTIDAD del alumno es su `userLogin`, así que el
 * email pasa a ser SOLO contacto y PUEDE repetirse entre hermanos.
 *
 * Este script (idempotente):
 *   PASO A: DROP del UNIQUE de USUARIOS_ROLES.email (permite emails repetidos).
 *   PASO B: backfill de los emails sintéticos → email REAL del apoderado, tomado
 *           (en orden) de: PEOPLE.email del beneficiario · PEOPLE.apoderadoMail del
 *           beneficiario · PEOPLE.apoderadoMail del titular · PEOPLE.email del titular.
 *           También alinea ACADEMICA.email al real. Sólo backfillea cuando hay un
 *           email real VÁLIDO y no-sintético; los que no tengan fuente quedan como
 *           están (el sintético es inofensivo: la resolución es por userLogin).
 *
 * ⚠ El orden importa: primero DROP del UNIQUE, luego el backfill — si se
 *   backfilleara antes, dos hermanos con el mismo email real chocarían con el UNIQUE.
 *
 * Uso: node scripts/fase2-emails-reales.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
const NORM = (c) => `REPLACE(REPLACE(REPLACE(${c},'.',''),'-',''),' ','')`;
const isSynthetic = (e) => !!e && /@est\.mosaico\.cl$/i.test(e.trim());
const isValidReal = (e) =>
  !!e && !isSynthetic(e) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });

  // ── PREFLIGHT ──
  const totSint = (await pool.query(
    `SELECT COUNT(*)::int n FROM "USUARIOS_ROLES" WHERE "email" ILIKE '%@est.mosaico.cl'`
  )).rows[0].n;

  const cands = (await pool.query(
    `SELECT ur."_id", ur."userLogin", ur."numberid", ur."email" AS synth,
            pb."email" AS pb_email, pb."apoderadoMail" AS pb_apo, pb."contrato" AS contrato,
            pt."apoderadoMail" AS pt_apo, pt."email" AS pt_email
       FROM "USUARIOS_ROLES" ur
       LEFT JOIN "PEOPLE" pb
              ON ${NORM('pb."numeroId"')} = ${NORM('ur."numberid"')}
             AND pb."tipoUsuario" = 'BENEFICIARIO'
       LEFT JOIN "PEOPLE" pt
              ON pt."contrato" = pb."contrato" AND pt."tipoUsuario" = 'TITULAR'
      WHERE ur."email" ILIKE '%@est.mosaico.cl'
      ORDER BY ur."userLogin"`
  )).rows;

  const pickReal = (r) => {
    for (const e of [r.pb_email, r.pb_apo, r.pt_apo, r.pt_email]) {
      if (isValidReal(e)) return e.trim().toLowerCase();
    }
    return null;
  };

  let conFuente = 0, sinFuente = 0;
  const sinFuenteList = [];
  const plan = [];
  for (const r of cands) {
    const real = pickReal(r);
    if (real) { conFuente++; plan.push({ id: r._id, userLogin: r.userLogin, numberid: r.numberid, real }); }
    else { sinFuente++; sinFuenteList.push(`${r.userLogin} (${r.numberid || 's/numberid'})`); }
  }

  // Constraint presente?
  const con = (await pool.query(
    `SELECT conname FROM pg_constraint
      WHERE conrelid = '"USUARIOS_ROLES"'::regclass AND contype='u'
        AND conname = 'USUARIOS_ROLES_email_key'`
  )).rows;

  console.log('─── Fase 2 · emails reales ───');
  console.log(`UNIQUE USUARIOS_ROLES_email_key: ${con.length ? 'PRESENTE' : 'ya eliminado'}`);
  console.log(`Emails sintéticos (@est.mosaico.cl): ${totSint}`);
  console.log(`  · con email real disponible (se backfillean): ${conFuente}`);
  console.log(`  · SIN fuente de email real (quedan sintéticos): ${sinFuente}`);
  if (sinFuenteList.length) {
    console.log('    ' + sinFuenteList.slice(0, 40).join(', ') + (sinFuenteList.length > 40 ? ` … (+${sinFuenteList.length - 40})` : ''));
  }

  if (!APPLY) {
    console.log('\n(dry-run) — nada escrito. Corre con --apply para: DROP UNIQUE + backfill.');
    await pool.end();
    return;
  }

  // ── PASO A: DROP UNIQUE (idempotente) ──
  await pool.query(`ALTER TABLE "USUARIOS_ROLES" DROP CONSTRAINT IF EXISTS "USUARIOS_ROLES_email_key"`);
  console.log('\n✅ PASO A: UNIQUE USUARIOS_ROLES_email_key eliminado (o ya no existía).');

  // ── PASO B: backfill sintético → real (por identidad; userLogin único) ──
  let ok = 0, err = 0;
  for (const p of plan) {
    try {
      await pool.query(
        `UPDATE "USUARIOS_ROLES" SET "email"=$2, "_updatedDate"=NOW() WHERE "_id"=$1`,
        [p.id, p.real]
      );
      // Alinear ACADEMICA.email del alumno (por userLogin) al email real.
      if (p.userLogin) {
        await pool.query(
          `UPDATE "ACADEMICA" SET "email"=$2, "_updatedDate"=NOW() WHERE "userLogin"=$1`,
          [p.userLogin, p.real]
        );
      }
      ok++;
    } catch (e) { err++; console.warn(`  ⚠️ ${p.userLogin}: ${e.message}`); }
  }
  console.log(`✅ PASO B: backfill aplicado — ${ok} cuentas → email real${err ? `, ${err} con error` : ''}.`);
  console.log(`   Quedan ${sinFuente} sintéticos sin fuente (inofensivos; identidad es userLogin).`);

  await pool.end();
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
