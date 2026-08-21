/**
 * Pone al día `CURSOS_CAMPAIGN.usuInscritos`, el contador VIEJO de inscritos.
 *
 * Ninguna pantalla lo usa: los cupos se calculan al leer con la regla de
 * `lib/cupo` (quien tiene el asiento confirmado o reservado, no está en OnHold,
 * no soltó el cupo y su contrato no está retractado/rechazado/devuelto/nulo).
 * La columna quedó ahí desde antes y se fue desincronizando, así que quien mire
 * la tabla por el visor de BD ve un número que no es el bueno.
 *
 * Esto la deja igual a lo que muestra Campañas. **No la mantiene nadie**: se
 * volverá a desviar en cuanto cambie un estado, porque el valor real se calcula
 * al leer. Para que deje de divergir habría que dejar de escribirla y borrarla,
 * que es otra decisión.
 *
 * Sólo lectura salvo con `--apply`.
 * Uso: node scripts/sincronizar-usuinscritos.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

// Misma regla que `cupoOcupadoSql` — se escribe aquí porque el script no puede
// importar el módulo de la app (es `server-only` y TypeScript).
const OCUPA = (a) => `((${a}."cupoConfirmado" IS TRUE OR ${a}."cupoReservadoHasta" > NOW())
  AND ${a}."fechaOnHold" IS NULL
  AND ${a}."cupoLiberado" IS NOT TRUE
  AND NOT (${a}."estadoInactivo" IS TRUE AND COALESCE(${a}."suspenddata"->>'accion','') = 'INACTIVACION')
  AND NOT EXISTS (SELECT 1 FROM "PEOPLE" t WHERE t."contrato" = ${a}."contrato"
    AND t."tipoUsuario" = 'TITULAR'
    AND LOWER(TRIM(COALESCE(t."aprobacion",''))) IN ('devuelto','rechazado','retractado','contrato nulo')))`;

const REAL = `
  SELECT cc."_id", cc."campaign", cc."tipoCurso", cc."salon", cc."horarioCurso",
         COALESCE(cc."usuInscritos",0)::int AS guardado,
         (SELECT COUNT(*)::int FROM "PEOPLE" pe
           WHERE pe."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA')
             AND pe."campaign" = cc."campaign" AND pe."tipoCurso" = cc."tipoCurso"
             AND pe."horarioCurso" = cc."horarioCurso" AND ${OCUPA('pe')}) AS real
    FROM "CURSOS_CAMPAIGN" cc`;

(async () => {
  console.log(APPLY ? '\n=== APLICANDO ===\n' : '\n=== DRY-RUN (usa --apply) ===\n');

  const { rows } = await pool.query(REAL);
  const desviados = rows.filter(r => Number(r.guardado) !== Number(r.real));
  console.log(`  salones: ${rows.length} · desviados: ${desviados.length}\n`);
  if (!desviados.length) { console.log('  ✅ La columna ya coincide con lo que muestra Campañas.\n'); await pool.end(); return; }

  console.table(desviados.slice(0, 15).map(r => ({
    salon: `${r.campaign} · ${r.tipoCurso} · ${r.salon}`,
    'columna guardada': r.guardado, 'valor real': r.real, diferencia: Number(r.guardado) - Number(r.real),
  })));
  if (desviados.length > 15) console.log(`  … y ${desviados.length - 15} más`);

  if (!APPLY) { console.log('\n  (dry-run: no se escribió nada)\n'); await pool.end(); return; }

  const r = await pool.query(`
    UPDATE "CURSOS_CAMPAIGN" cc SET "usuInscritos" = sub.real, "_updatedDate" = NOW()
      FROM (${REAL}) sub
     WHERE cc."_id" = sub."_id" AND COALESCE(cc."usuInscritos",0) <> sub.real`);
  console.log(`\n  actualizados: ${r.rowCount}`);
  const quedan = (await pool.query(REAL)).rows.filter(x => Number(x.guardado) !== Number(x.real)).length;
  console.log(`  desviados tras aplicar: ${quedan}\n`);
  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
