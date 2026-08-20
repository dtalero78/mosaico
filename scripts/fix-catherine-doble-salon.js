/**
 * Catherine Cáceres (142136171) quedó agendada en DOS salones a la vez.
 *
 * Qué pasó, según los propios registros:
 *  · 17-ago — al APROBAR su contrato estaba en SENPAI · 04 (SÁB 11:00-13:00), así
 *    que el sistema le generó allí sus 31 clases (`Sistema (aprobación contrato)`).
 *  · después se le cambió el salón a SENPAI · 02 (MAR-JUE 20:00-20:50) editando la
 *    ficha directamente — `cambioAcademicoHistory` está VACÍO, así que no pasó por
 *    "Cambio Académico", que es lo que borra los agendamientos del salón viejo.
 *  · 20-ago — se usó Mantenimiento › Booking, que le creó las 62 de SENPAI · 02.
 *    Booking sólo AGREGA lo que falta del curso actual; no toca lo del anterior.
 * Resultado: 62 + 31 clases, y su guía de SENPAI 04 la sigue viendo en la lista.
 *
 * Además hay UNA fila creada a mano desde el visor de BD cuyos dos punteros al
 * evento NO coinciden: `eventoId` → SENPAI 02 del 18-ago y `idEvento` → SENPAI 04
 * del 3-abr-2027. Se cuenta en los dos salones a la vez.
 *
 * Este script: (1) alinea esa fila rota, (2) borra las 31 de SENPAI 04 y ajusta el
 * contador `inscritos` de sus eventos. Las 31 NO tienen asistencia, participación,
 * calificación ni anotaciones — se comprueba antes de borrar y aborta si aparece
 * alguna: eso sería historia que no se puede reconstruir.
 *
 * Uso: node scripts/fix-catherine-doble-salon.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const ACADEMICA = 'acd_1786759089375_9xekqltt5';
const SALON_SOBRA = '04';
const ROTA = 'dbmosaico_1787184266288_hli5kn';
const APPLY = process.argv.includes('--apply');

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const SOBRAN = `
  SELECT k."_id", k."eventoId"
    FROM "ACADEMICA_BOOKINGS" k
    JOIN "CALENDARIO" e ON e."_id" = k."eventoId"
    JOIN "CURSOS_CAMPAIGN" cc ON cc."_id" = e."cursoCampaignId"
   WHERE (k."idEstudiante" = $1 OR k."studentId" = $1)
     AND cc."tipoCurso" = 'SENPAI' AND cc."salon" = $2
     AND k."_id" <> $3`;

(async () => {
  const c = await pool.connect();
  try {
    console.log(APPLY ? '\n=== APLICANDO ===\n' : '\n=== DRY-RUN (usa --apply) ===\n');

    // 1) La fila rota
    const rota = (await c.query(
      `SELECT "_id","eventoId","idEvento" FROM "ACADEMICA_BOOKINGS" WHERE "_id" = $1`, [ROTA])).rows[0];
    if (!rota) console.log('  fila rota: ya no existe');
    else if (rota.eventoId === rota.idEvento) console.log('  fila rota: ya está alineada');
    else console.log(`  fila rota: idEvento ${rota.idEvento} → ${rota.eventoId}`);

    // 2) Las que sobran, y la comprobación de que no llevan historia
    const sobran = (await c.query(SOBRAN, [ACADEMICA, SALON_SOBRA, ROTA])).rows;
    const conRegistro = (await c.query(`
      SELECT COUNT(*)::int n FROM "ACADEMICA_BOOKINGS" k
       WHERE k."_id" = ANY($1)
         AND (k."asistio" = true OR k."asistencia" = true OR k."participacion" = true
              OR k."noAprobo" = true OR k."cancelo" = true OR k."calificacion" IS NOT NULL
              OR COALESCE(k."advisorAnotaciones",'') <> '' OR COALESCE(k."comentarios",'') <> '')`,
      [sobran.map(r => r._id)])).rows[0].n;

    console.log(`  agendamientos en SENPAI ${SALON_SOBRA} a borrar: ${sobran.length}`);
    console.log(`  de ésos, CON historia (asistencia/nota/anotación): ${conRegistro}`);
    if (conRegistro > 0) {
      console.error('\n  ⛔ Hay historia registrada: no se borra nada. Revisar a mano.\n');
      process.exit(1);
    }

    if (!APPLY) { console.log('\n  (dry-run: no se escribió nada)\n'); return; }

    await c.query('BEGIN');
    if (rota && rota.eventoId !== rota.idEvento) {
      await c.query(`UPDATE "ACADEMICA_BOOKINGS" SET "idEvento" = "eventoId", "_updatedDate" = NOW()
                      WHERE "_id" = $1`, [ROTA]);
    }
    const ids = sobran.map(r => r._id);
    if (ids.length) {
      await c.query(`DELETE FROM "ACADEMICA_BOOKINGS" WHERE "_id" = ANY($1)`, [ids]);
      // El contador del evento se mantiene al día (lo sube la generación).
      await c.query(
        `UPDATE "CALENDARIO" SET "inscritos" = GREATEST(COALESCE("inscritos",1) - 1, 0), "_updatedDate" = NOW()
          WHERE "_id" = ANY($1)`, [sobran.map(r => r.eventoId)]);
    }
    await c.query('COMMIT');
    console.log(`\n  borrados: ${ids.length}`);

    const fin = (await c.query(`
      SELECT cc."tipoCurso"||' · '||cc."salon" salon, COUNT(*)::int agendamientos
        FROM "ACADEMICA_BOOKINGS" k
        JOIN "CALENDARIO" e ON e."_id" = k."eventoId"
        JOIN "CURSOS_CAMPAIGN" cc ON cc."_id" = e."cursoCampaignId"
       WHERE k."idEstudiante" = $1 OR k."studentId" = $1
       GROUP BY 1 ORDER BY 1`, [ACADEMICA])).rows;
    console.log('\n  Cómo queda:');
    console.table(fin);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
