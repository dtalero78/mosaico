/**
 * Índices de ACADEMICA_BOOKINGS sobre "idEstudiante" e "idEvento" (columnas legacy
 * que las consultas siguen usando con OR junto a "studentId"/"eventoId"). Sin ellos
 * cada cruce recorría los ~100k agendamientos: Procesos sin gestión › Eventos
 * registrados tardaba 77 s y Casos de Atención 20-30 s. CONCURRENTLY: no bloquea.
 * Idempotente. Uso: node scripts/add-bookings-indices-idestudiante-idevento.js
 */
const { Pool } = require('pg'); require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ connectionString:(process.env.DATABASE_URL||'').replace(/[?&]sslmode=[^&]*/g,''), ssl:{rejectUnauthorized:false}, statement_timeout:0 });
(async () => {
  const c = await pool.connect();
  for (const [n, col] of [['idx_bookings_idestudiante','idEstudiante'],['idx_bookings_idevento','idEvento']]) {
    const r = await c.query(`SELECT i.indisvalid FROM pg_index i WHERE i.indexrelid = to_regclass($1)`, [n]);
    if (r.rows[0]?.indisvalid) { console.log(n, 'ya existe'); continue; }
    if (r.rows.length) await c.query(`DROP INDEX CONCURRENTLY IF EXISTS ${n}`);   // quedó inválido
    await c.query(`CREATE INDEX CONCURRENTLY ${n} ON "ACADEMICA_BOOKINGS" ("${col}")`);
    console.log(n, 'creado');
  }
  c.release(); await pool.end();
})();
