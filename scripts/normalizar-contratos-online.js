/**
 * Normaliza los contratos que quedaron guardados con el texto del documento
 * en vez del número:
 *
 *   "Contrato Online N.º 5-2593-26"   → "01-M5-2593-26"
 *   "Contrato Online N.º 05-2852-26"  → "01-M5-2852-26"   (se quita el 0 inicial)
 *   "Contrato Online N.º 6-115-26"    → "01-I6-115-26"    (6 = IMPULSA)
 *
 * Es el mismo formato canónico de `scripts/renombrar-contratos-canonico.js`:
 * `01-<M5|I6>-NNNNN-AA` (01 = Chile).
 *
 * ⚠ El número de contrato es la LLAVE que une las tablas, así que se actualiza
 * en las SEIS que lo guardan — hacerlo sólo en PEOPLE y ACADEMICA dejaría el
 * login, lo financiero y la auditoría apuntando a un contrato que ya no existe.
 *
 * ⚠ Muchos destinos YA existen, pero **no son otro contrato**: es el MISMO
 * contrato desincronizado (PEOPLE tiene el número canónico y USUARIOS_ROLES o
 * FINANCIEROS se quedaron con el texto crudo). Verificado antes de escribir:
 * 0 casos en que el destino perteneciera a personas distintas. El script lo
 * vuelve a comprobar y ABORTA si aparece uno nuevo.
 *
 * Uso: node scripts/normalizar-contratos-online.js [--apply]
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const TABLAS = ['PEOPLE', 'ACADEMICA', 'USUARIOS_ROLES', 'FINANCIEROS', 'ACTIVE_STUDENTS', 'auditautoaprov', 'CASOS_ATENCION'];

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

/** Devuelve el número canónico, o null si el texto no se puede interpretar. */
function canonico(valor) {
  // Tolera "N.º" y "N. º" (hay una fila con el espacio de más).
  const m = String(valor || '').trim().match(/^Contrato\s+Online\s+N\.\s*º\s*(.+)$/i);
  if (!m) return null;
  // <segmento 1 dígito, con 0 opcional delante>-<número>-<año 2 dígitos>
  const n = m[1].trim().match(/^0?(\d)-(\d+)-(\d{2})$/);
  if (!n) return null;
  const seg = n[1] === '6' ? 'I6' : `M${n[1]}`;
  return `01-${seg}-${n[2]}-${n[3]}`;
}

/** numeroId asociados a un contrato, para comprobar que no se mezclan personas. */
async function idsDe(client, contrato) {
  const { rows } = await client.query(
    `SELECT DISTINCT "numeroId" AS id FROM "PEOPLE"      WHERE "contrato"=$1 AND "numeroId" IS NOT NULL
     UNION
     SELECT DISTINCT "numberid"        FROM "USUARIOS_ROLES" WHERE "contrato"=$1 AND "numberid" IS NOT NULL`,
    [contrato]
  );
  return new Set(rows.map(r => r.id));
}

(async () => {
  const client = await pool.connect();
  try {
    // 1. Universo de valores a convertir, mirando TODAS las tablas
    const valores = new Map(); // viejo -> { tabla: filas }
    for (const t of TABLAS) {
      try {
        const { rows } = await client.query(
          `SELECT "contrato" AS v, COUNT(*)::int AS n FROM "${t}"
            WHERE "contrato" ILIKE 'Contrato%Online%' GROUP BY 1`);
        for (const r of rows) {
          if (!valores.has(r.v)) valores.set(r.v, {});
          valores.get(r.v)[t] = r.n;
        }
      } catch { /* tabla inexistente */ }
    }

    const plan = [], sinConvertir = [];
    for (const [viejo, porTabla] of valores) {
      const nuevo = canonico(viejo);
      const filas = Object.values(porTabla).reduce((a, b) => a + b, 0);
      (nuevo ? plan : sinConvertir).push({ viejo, nuevo, porTabla, filas });
    }
    plan.sort((a, b) => a.nuevo.localeCompare(b.nuevo));

    console.log(`Valores con el texto "Contrato Online": ${valores.size}`);
    console.log(`  se convierten: ${plan.length}`);
    console.log(`  se dejan:      ${sinConvertir.length}\n`);

    // 2. Comprobar que ningún renombre mezcla personas distintas
    const conflictos = [];
    for (const item of plan) {
      const destino = await idsDe(client, item.nuevo);
      if (!destino.size) { item.nota = 'destino libre'; continue; }
      const origen = await idsDe(client, item.viejo);
      const comparten = [...origen].some(x => destino.has(x));
      if (comparten || !origen.size) {
        item.nota = 'mismo contrato — el renombre repara la desincronización';
      } else {
        item.nota = '⚠ PERSONAS DISTINTAS';
        conflictos.push({ viejo: item.viejo, nuevo: item.nuevo, origen: [...origen].join(','), destino: [...destino].join(',') });
      }
    }

    const porTabla = {};
    for (const it of plan) for (const [t, n] of Object.entries(it.porTabla)) porTabla[t] = (porTabla[t] || 0) + n;
    console.log('Filas a actualizar por tabla:');
    console.table(Object.entries(porTabla).map(([tabla, filas]) => ({ tabla, filas })));
    console.log(`TOTAL: ${Object.values(porTabla).reduce((a, b) => a + b, 0)} filas\n`);

    console.log('Conversión:');
    console.table(plan.map(i => ({ de: i.viejo, a: i.nuevo, filas: i.filas, nota: i.nota })));

    if (sinConvertir.length) {
      console.log('\n⚠ NO se tocan (revisar a mano — el número no se puede deducir sin adivinar):');
      console.table(sinConvertir.map(i => ({ valor: i.viejo, filas: i.filas })));
    }

    if (conflictos.length) {
      console.error('\n✗ ABORTADO: hay renombres que mezclarían contratos de personas distintas.');
      console.table(conflictos);
      process.exitCode = 1;
      return;
    }

    if (!APPLY) {
      console.log('\n(dry-run — nada se escribió. Volvé a correr con --apply)');
      return;
    }

    // 3. Respaldo del mapeo antes de tocar nada
    const backup = path.join(process.cwd(), `contratos-online-mapeo-${new Date().toISOString().slice(0, 10)}.json`);
    fs.writeFileSync(backup, JSON.stringify({ plan, sinConvertir }, null, 2), 'utf8');
    console.log(`\nRespaldo del mapeo: ${backup}`);

    await client.query('BEGIN');
    let total = 0;
    for (const it of plan) {
      for (const t of Object.keys(it.porTabla)) {
        const r = await client.query(`UPDATE "${t}" SET "contrato"=$2 WHERE "contrato"=$1`, [it.viejo, it.nuevo]);
        total += r.rowCount;
      }
    }
    await client.query('COMMIT');
    console.log(`\n✓ ${total} fila(s) actualizadas en ${plan.length} contrato(s).`);

    const { rows: [{ n }] } = await client.query(
      `SELECT (SELECT COUNT(*) FROM "PEOPLE" WHERE "contrato" ILIKE 'Contrato%Online%')
            + (SELECT COUNT(*) FROM "ACADEMICA" WHERE "contrato" ILIKE 'Contrato%Online%')
            + (SELECT COUNT(*) FROM "USUARIOS_ROLES" WHERE "contrato" ILIKE 'Contrato%Online%')
            + (SELECT COUNT(*) FROM "FINANCIEROS" WHERE "contrato" ILIKE 'Contrato%Online%')
            + (SELECT COUNT(*) FROM "ACTIVE_STUDENTS" WHERE "contrato" ILIKE 'Contrato%Online%')
            + (SELECT COUNT(*) FROM "auditautoaprov" WHERE "contrato" ILIKE 'Contrato%Online%') AS n`);
    console.log(`Quedan con el texto viejo: ${n} fila(s) — las ${sinConvertir.reduce((a, b) => a + b.filas, 0)} que no se pudieron deducir.`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { }
    console.error('✗ Falló, no se escribió nada:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
