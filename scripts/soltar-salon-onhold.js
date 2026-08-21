/**
 * Alumnos que ya estaban en OnHold antes de que OnHold soltara el salón.
 *
 * Desde agosto-2026, entrar en OnHold libera el asiento **y** borra el curso y las
 * clases por dictar: al volver se le asigna un curso nuevo, porque el suyo habrá
 * avanzado sin él. Los que entraron antes conservan su curso y sus clases futuras,
 * así que siguen apareciendo en el salón — en el Reporte Académico, en la Lista de
 * Usuarios y en la lista de su guía — aunque no vayan a asistir.
 *
 * Esto les aplica la misma regla. Las clases YA DICTADAS no se tocan: son su
 * historia y al volver querrá ver lo que alcanzó a cursar. El curso de origen
 * queda anotado en su `onHoldHistory`, para saber de dónde salió.
 *
 * Idempotente. Uso: node scripts/soltar-salon-onhold.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const PENDIENTES = `
  SELECT b."_id", b."numeroId",
         TRIM(CONCAT_WS(' ', b."primerNombre", b."primerApellido")) AS alumno,
         b."contrato",
         CONCAT_WS(' · ', b."campaign", b."tipoCurso", b."horarioCurso", b."salon") AS curso,
         (SELECT COUNT(*)::int FROM "ACADEMICA" a
            JOIN "ACADEMICA_BOOKINGS" k ON (k."idEstudiante" = a."_id" OR k."studentId" = a."_id")
            JOIN "CALENDARIO" c ON (c."_id" = k."eventoId" OR c."_id" = k."idEvento")
           WHERE a."peopleId" = b."_id" AND c."dia" >= NOW()) AS "clases futuras"
    FROM "PEOPLE" b
   WHERE b."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA')
     AND b."fechaOnHold" IS NOT NULL
     AND (COALESCE(b."tipoCurso",'') <> '' OR COALESCE(b."campaign",'') <> '')`;

(async () => {
  console.log(APPLY ? '\n=== APLICANDO ===\n' : '\n=== DRY-RUN (usa --apply) ===\n');

  const { rows } = await pool.query(PENDIENTES);
  if (!rows.length) { console.log('  ✅ Ningún alumno en OnHold conserva su salón.\n'); await pool.end(); return; }

  console.table(rows.map(r => ({
    alumno: r.alumno, contrato: r.contrato, curso: r.curso, 'clases por dictar': r['clases futuras'],
  })));
  if (!APPLY) { console.log('\n  (dry-run: no se escribió nada)\n'); await pool.end(); return; }

  for (const r of rows) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const ac = await c.query(
        `SELECT "_id" FROM "ACADEMICA" WHERE "peopleId" = $1
          UNION SELECT "_id" FROM "ACADEMICA" WHERE $2 <> '' AND "numeroId" = $2`,
        [r._id, r.numeroId || '']);
      const ids = ac.rows.map(x => x._id);
      let borrados = 0;
      if (ids.length) {
        const del = await c.query(
          `DELETE FROM "ACADEMICA_BOOKINGS" b USING "CALENDARIO" cal
            WHERE (cal."_id" = b."eventoId" OR cal."_id" = b."idEvento")
              AND cal."dia" >= NOW()
              AND (b."idEstudiante" = ANY($1::text[]) OR b."studentId" = ANY($1::text[]))
            RETURNING cal."_id" AS evid`, [ids]);
        borrados = del.rowCount ?? 0;
        const evs = Array.from(new Set(del.rows.map(x => x.evid).filter(Boolean)));
        if (evs.length) {
          await c.query(`UPDATE "CALENDARIO" SET "inscritos" = GREATEST(0, COALESCE("inscritos",0) - 1),
                           "_updatedDate" = NOW() WHERE "_id" = ANY($1::text[])`, [evs]);
        }
        await c.query(`UPDATE "ACADEMICA" SET "campaign" = NULL, "salon" = NULL, "_updatedDate" = NOW()
                        WHERE "_id" = ANY($1::text[])`, [ids]);
      }
      // Se anota de dónde salió en la última entrada de su historial de OnHold.
      await c.query(
        `UPDATE "PEOPLE"
            SET "campaign" = NULL, "tipoCurso" = NULL, "horarioCurso" = NULL, "salon" = NULL,
                "onHoldHistory" = CASE
                  WHEN jsonb_typeof("onHoldHistory") = 'array' AND jsonb_array_length("onHoldHistory") > 0
                  THEN jsonb_set("onHoldHistory", ARRAY[(jsonb_array_length("onHoldHistory")-1)::text, 'cursoAlPausar'], to_jsonb($2::text))
                  ELSE "onHoldHistory" END,
                "_updatedDate" = NOW()
          WHERE "_id" = $1`, [r._id, r.curso]);
      await c.query('COMMIT');
      console.log(`  ${r.alumno}: soltó ${r.curso} · ${borrados} clase(s) por dictar retiradas`);
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      console.error(`  ERROR con ${r.alumno}: ${e.message}`);
    } finally { c.release(); }
  }
  console.log(`\n  pendientes tras aplicar: ${(await pool.query(PENDIENTES)).rows.length}\n`);
  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
