/**
 * Agrega NIVELES."actividadesWordwallModulo" (JSONB, lista [{nombre,link}]) para
 * soportar VARIAS actividades WordWall por módulo (antes: una sola en
 * actividadWordwallModulo/actividadWordwallModuloNombre). Kahoot queda descontinuado.
 *
 * Backfill: si el módulo tenía una WordWall única y el array está vacío, la migra a
 * [{nombre, link}] para no perderla. Idempotente (solo rellena arrays vacíos).
 *
 * Uso: node scripts/add-niveles-actividades-wordwall-modulo.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const cli = await pool.connect();
  try {
    console.log(APPLY ? '== APPLY ==' : '== DRY-RUN (usa --apply para escribir) ==');

    // 1) Columna
    if (APPLY) {
      await cli.query(`ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "actividadesWordwallModulo" JSONB DEFAULT '[]'::jsonb`);
      console.log('✓ Columna actividadesWordwallModulo lista');
    } else {
      console.log('· (dry) ALTER TABLE ADD COLUMN IF NOT EXISTS "actividadesWordwallModulo" JSONB');
    }

    // 2) Candidatas a backfill: filas con WordWall único y array vacío/nulo
    const cand = await cli.query(`
      SELECT "_id","actividadWordwallModulo","actividadWordwallModuloNombre"
        FROM "NIVELES"
       WHERE COALESCE("actividadWordwallModulo",'') <> ''
         AND COALESCE(jsonb_array_length(COALESCE("actividadesWordwallModulo",'[]'::jsonb)),0) = 0`);
    console.log(`Filas a backfillear (WordWall único → array): ${cand.rowCount}`);

    if (APPLY && cand.rowCount) {
      let n = 0;
      for (const r of cand.rows) {
        const item = [{ nombre: String(r.actividadWordwallModuloNombre || 'WordWall').trim(), link: String(r.actividadWordwallModulo).trim() }];
        await cli.query(
          `UPDATE "NIVELES" SET "actividadesWordwallModulo" = $1::jsonb, "_updatedDate" = NOW() WHERE "_id" = $2`,
          [JSON.stringify(item), r._id]
        );
        n++;
      }
      console.log(`✓ Backfill aplicado a ${n} filas`);
    }

    // 3) Verificación
    const tot = await cli.query(`SELECT COUNT(*)::int c FROM "NIVELES" WHERE jsonb_array_length(COALESCE("actividadesWordwallModulo",'[]'::jsonb)) > 0`);
    console.log(`Filas con al menos 1 WordWall en el array: ${tot.rows[0].c}`);
  } catch (e) {
    console.error('ERR:', e.message);
    process.exit(1);
  } finally {
    cli.release();
    await pool.end();
  }
})();
