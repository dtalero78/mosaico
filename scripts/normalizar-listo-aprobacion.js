/**
 * Normaliza `PEOPLE.listoAprobacion` en los contratos YA APROBADOS que nunca
 * pasaron por el botón amarillo "Contrato Para Aprobación".
 *
 * Hay dos marcas de "listo" con nombre parecido y significado distinto:
 *   · `listoAprobacion` (fecha)     → botón amarillo del detalle del contrato;
 *                                     hace que salga en el Centro de Aprobaciones.
 *   · `gestionContratoListo` (sí/no) → "Dejar listo" de Gestión Contrato; RESERVA
 *                                     el cupo y es el que la aprobación exige.
 * En la práctica se aprobó por la segunda vía, así que 396 aprobados quedaron sin
 * la primera. Esto los empareja.
 *
 * La fecha y el autor se COPIAN de la auditoría de gestión (`gestionContratoListoDate`
 * / `By`) en vez de inventarse: si esa marca la puso un backfill, el autor copiado
 * lo dice — y así el registro no aparenta un clic que nunca ocurrió.
 *
 * NO toca contratos sin aprobar, ni los que ya tienen `listoAprobacion` (respeta la
 * marca original). Sin efecto funcional: el Centro de Aprobaciones filtra por
 * `listoAprobacion AND NOT aprobacion`, y todos éstos ya están aprobados.
 *
 * Uso: node scripts/normalizar-listo-aprobacion.js [--apply]
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const OBJETIVO = `
  "tipoUsuario" = 'TITULAR'
  AND LOWER(COALESCE("aprobacion",'')) IN ('aprobado','aprobada')
  AND "listoAprobacion" IS NULL
`;

(async () => {
  const c = await pool.connect();
  try {
    console.log(APPLY ? '\n=== APLICANDO ===\n' : '\n=== DRY-RUN (usa --apply) ===\n');

    const alcance = (await c.query(`
      SELECT COUNT(*)::int total,
             COUNT("gestionContratoListoDate")::int con_auditoria,
             (COUNT(*) - COUNT("gestionContratoListoDate"))::int sin_auditoria
        FROM "PEOPLE" WHERE ${OBJETIVO}`)).rows[0];
    console.log(`  Aprobados sin listoAprobacion: ${alcance.total}`);
    console.log(`    · con auditoría de gestión (se copia):  ${alcance.con_auditoria}`);
    console.log(`    · sin auditoría (quedan fuera, se listan): ${alcance.sin_auditoria}`);

    console.log('\n  Origen de la marca que se copiaría:');
    console.table((await c.query(`
      SELECT "gestionContratoListoBy" origen, COUNT(*)::int titulares
        FROM "PEOPLE" WHERE ${OBJETIVO} AND "gestionContratoListoDate" IS NOT NULL
       GROUP BY 1 ORDER BY 2 DESC`)).rows);

    const fuera = (await c.query(`
      SELECT "_id", "contrato", "primerNombre", "primerApellido"
        FROM "PEOPLE" WHERE ${OBJETIVO} AND "gestionContratoListoDate" IS NULL`)).rows;
    if (fuera.length) {
      console.log('\n  ⚠ Sin auditoría de gestión — NO se tocan (requieren revisión manual):');
      console.table(fuera);
    }

    if (!APPLY) { console.log('\n  (dry-run: no se escribió nada)\n'); return; }

    const upd = await c.query(`
      UPDATE "PEOPLE"
         SET "listoAprobacion"    = "gestionContratoListoDate",
             "listoAprobacionPor" = COALESCE("gestionContratoListoBy", 'desconocido'),
             "_updatedDate"       = NOW()
       WHERE ${OBJETIVO} AND "gestionContratoListoDate" IS NOT NULL
       RETURNING "_id"`);
    console.log(`\n  actualizados: ${upd.rowCount}`);

    console.log('\n  Estado final de los titulares:');
    console.table((await c.query(`
      SELECT CASE WHEN "listoAprobacion" IS NOT NULL THEN 'listoAprobacion ✔' ELSE 'listoAprobacion ✗' END marca,
             CASE WHEN LOWER(COALESCE("aprobacion",'')) IN ('aprobado','aprobada') THEN 'aprobado' ELSE 'sin aprobar' END estado,
             COUNT(*)::int titulares
        FROM "PEOPLE" WHERE "tipoUsuario"='TITULAR' GROUP BY 1,2 ORDER BY 3 DESC`)).rows);
    console.log('');
  } finally {
    c.release();
    await pool.end();
  }
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
