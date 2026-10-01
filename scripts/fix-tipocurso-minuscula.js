/**
 * Corrige PEOPLE."tipoCurso" escrito en minúsculas ("senpai") y le completa el
 * salón desde CURSOS_CAMPAIGN.
 *
 * El curso es parte de la llave del salón (campaña + curso + horario) y el
 * catálogo lo guarda en MAYÚSCULAS, así que un "senpai" no encuentra su salón:
 * el alumno queda con el cupo pero sin curso real, sin agendamientos y fuera de
 * las listas de su salón. Llegó por Subir Lote, que no normalizaba el valor (ya
 * lo hace `insertBeneficiarioTx`).
 *
 * Uso: node scripts/fix-tipocurso-minuscula.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows } = await pool.query(
    `SELECT p."_id", p."contrato", p."primerNombre", p."primerApellido", p."campaign",
            p."tipoCurso", p."horarioCurso", p."salon", cc."salon" AS "salonCurso"
       FROM "PEOPLE" p
       LEFT JOIN "CURSOS_CAMPAIGN" cc
         ON cc."campaign" = p."campaign" AND cc."tipoCurso" = UPPER(TRIM(p."tipoCurso"))
        AND cc."horarioCurso" = p."horarioCurso"
      WHERE p."tipoCurso" IS NOT NULL AND p."tipoCurso" <> UPPER(TRIM(p."tipoCurso"))`
  );
  console.table(rows.map(r => ({
    contrato: r.contrato, nombre: `${r.primerNombre} ${r.primerApellido}`,
    curso: `${r.tipoCurso} → ${String(r.tipoCurso).trim().toUpperCase()}`,
    salon: `${r.salon ?? '—'} → ${r.salon ?? r.salonCurso ?? '—'}`,
  })));

  if (!APPLY) { console.log('\n(dry-run) Reejecuta con --apply.'); await pool.end(); return; }

  let n = 0;
  for (const r of rows) {
    await pool.query(
      `UPDATE "PEOPLE" SET "tipoCurso" = UPPER(TRIM("tipoCurso")),
              "salon" = COALESCE("salon", $2), "_updatedDate" = NOW()
        WHERE "_id" = $1`,
      [r._id, r.salonCurso || null]
    );
    n++;
  }
  console.log(`\n✅ ${n} registro(s) corregidos.`);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
