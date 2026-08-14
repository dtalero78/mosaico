/**
 * SENPAI: cuando el TITULAR del contrato ES el propio beneficiario y la ficha no
 * tiene apoderado, se define como apoderado a ese mismo titular.
 *
 * Por qué: en SENPAI el alumno suele ser adulto y firma su propio contrato, así
 * que la ficha se creó sin apoderado — y sin apoderado no hay a quién escribirle
 * (p. ej. el envío de la "Actividad IA" de la sesión). Como el titular y el
 * beneficiario son LA MISMA PERSONA (mismo numeroId), copiar sus datos no
 * inventa un contacto: lo deja explícito.
 *
 * NO toca los cursos de menores (YOJI/OKINA/KODOMO/DANSHI): ahí el apoderado es
 * un tercero y que falte es un dato incompleto, no algo deducible.
 * NO pisa fichas que ya tengan teléfono de apoderado.
 *
 * Idempotente. Uso: node scripts/backfill-apoderado-senpai.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const nombreDe = (t) => [t.primerNombre, t.segundoNombre, t.primerApellido, t.segundoApellido]
  .map(s => String(s || '').trim()).filter(Boolean).join(' ').trim();

(async () => {
  const { rows } = await pool.query(
    `SELECT b."_id", b."numeroId", b."contrato",
            TRIM(CONCAT_WS(' ', b."primerNombre", b."primerApellido")) AS alumno,
            b."celular" AS celular_alumno,
            t."primerNombre", t."segundoNombre", t."primerApellido", t."segundoApellido",
            t."celular" AS titular_celular, t."email" AS titular_email
       FROM "PEOPLE" b
       JOIN LATERAL (
         SELECT tt.* FROM "PEOPLE" tt
          WHERE tt."contrato" = b."contrato" AND tt."tipoUsuario" = 'TITULAR' LIMIT 1
       ) t ON true
      WHERE b."tipoUsuario" = 'BENEFICIARIO'
        AND UPPER(b."tipoCurso") = 'SENPAI'
        AND COALESCE(b."apoderadoTelefono", '') = ''
        AND COALESCE(b."contrato", '') NOT LIKE 'PRB-%'
        -- El titular ES el propio beneficiario
        AND UPPER(TRIM(t."numeroId")) = UPPER(TRIM(b."numeroId"))
        AND COALESCE(t."celular", '') <> ''
      ORDER BY alumno`
  );

  if (!rows.length) {
    console.log('✅ No hay fichas SENPAI por completar.');
    await pool.end();
    return;
  }

  console.log(`\n${rows.length} beneficiario(s) SENPAI sin apoderado, con el titular = el propio alumno:\n`);
  console.table(rows.slice(0, 30).map(r => ({
    alumno: r.alumno, documento: r.numeroId, contrato: r.contrato,
    apoderado_nuevo: nombreDe(r), telefono: r.titular_celular, email: r.titular_email || '(sin email)',
  })));
  if (rows.length > 30) console.log(`… y ${rows.length - 30} más.`);

  if (!APPLY) {
    console.log('\n(dry-run — no se escribió nada. Reejecuta con --apply.)');
    await pool.end();
    return;
  }

  let ok = 0;
  for (const r of rows) {
    await pool.query(
      `UPDATE "PEOPLE"
          SET "apoderado"         = COALESCE(NULLIF(TRIM("apoderado"), ''), $1),
              "apoderadoTelefono" = $2,
              "apoderadoMail"     = COALESCE(NULLIF(TRIM("apoderadoMail"), ''), $3),
              "_updatedDate"      = NOW()
        WHERE "_id" = $4`,
      [nombreDe(r), r.titular_celular, r.titular_email || null, r._id]
    );
    ok++;
  }
  const { rows: [chk] } = await pool.query(
    `SELECT COUNT(*)::int pendientes FROM "PEOPLE" b
      WHERE b."tipoUsuario"='BENEFICIARIO' AND UPPER(b."tipoCurso")='SENPAI'
        AND COALESCE(b."apoderadoTelefono",'')='' AND COALESCE(b."contrato",'') NOT LIKE 'PRB-%'`
  );
  console.log(`\n✅ ${ok} ficha(s) actualizadas. SENPAI sin apoderado ahora: ${chk.pendientes}.`);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
