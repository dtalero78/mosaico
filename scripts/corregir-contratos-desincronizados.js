/**
 * Corrige contratos cuyo número quedó distinto entre tablas, uno por uno.
 *
 * A diferencia de `normalizar-contratos-a-canonico.js` —que deduce el destino
 * del propio texto—, aquí cada par viejo→nuevo está escrito a mano porque el
 * destino NO se puede deducir: hay que saber a qué contrato pertenece la
 * persona. Los cuatro primeros son el caso: el alumno figura con `5-2710-26`
 * pero su familia está en `01-M5-2710A-26` (con la A, que es parte del número);
 * deducirlo habría dado `01-M5-2710-26`, que es de OTRA familia.
 *
 * Cada par se verifica antes de escribir:
 *   - el origen existe;
 *   - si el destino ya existe, comparte al menos una persona con el origen
 *     (si no, son contratos distintos y no se toca);
 *   - no se duplica FINANCIEROS: si origen y destino tienen registro propio,
 *     se salta (habría que decidir antes cuál es el bueno).
 *
 * Uso:
 *   node scripts/corregir-contratos-desincronizados.js           (ensayo)
 *   node scripts/corregir-contratos-desincronizados.js --apply
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const TABLAS = ['PEOPLE', 'ACADEMICA', 'USUARIOS_ROLES', 'FINANCIEROS', 'ACTIVE_STUDENTS', 'auditautoaprov', 'CASOS_ATENCION'];

/** viejo → nuevo, con el motivo por el que ese destino es el correcto. */
const PARES = [
  // Alumnos que quedaron en ACADEMICA con el número sin sufijo, pero cuya
  // familia está en el contrato CON la A. Verificado por documento.
  ['5-2710-26', '01-M5-2710A-26', 'Keylor y Kendri Duran pertenecen al contrato con A'],
  ['5-2725-26', '01-M5-2725A-26', 'HERLIN LUNA pertenece al contrato con A'],
  ['5-2767-26', '01-M5-2767A-26', 'AGUSTIN MEZA pertenece al contrato con A'],
  ['5-2772-26', '01-M5-2772A-26', 'MAGDA VEGA pertenece al contrato con A'],
  // Restos en FINANCIEROS/auditoría con el número viejo: su contrato ya está en
  // canónico y NO tiene registro financiero propio, así que esto lo reconecta.
  ['5-2807-26', '01-M5-2807-26', 'FINANCIEROS de ELIZABETH SOTO, hoy sin enlazar'],
  ['5-2824-26', '01-M5-2824-26', 'FINANCIEROS de Claudia Albornoz, hoy sin enlazar'],
  ['5-2831-26', '01-M5-2831-26', 'FINANCIEROS de JULICSA FERNANDEZ, hoy sin enlazar'],
  // La "A" quedó pegada al año; va tras el consecutivo, como en los demás.
  ['Contrato Online N.º 5-2657-26A', '01-M5-2657A-26', 'mueve la A del año al consecutivo'],
];

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const norm = (v) => String(v || '').toUpperCase().replace(/[.\s-]/g, '');

async function personasDe(client, contrato) {
  const r = await client.query(
    'SELECT DISTINCT "numeroId" AS id FROM "PEOPLE" WHERE "contrato"=$1 AND "numeroId" IS NOT NULL' +
    ' UNION SELECT DISTINCT "numeroId" FROM "ACADEMICA" WHERE "contrato"=$1 AND "numeroId" IS NOT NULL',
    [contrato]
  );
  return new Set(r.rows.map((x) => norm(x.id)));
}

(async () => {
  const client = await pool.connect();
  try {
    const plan = [], saltados = [];

    for (const [viejo, nuevo, motivo] of PARES) {
      let filas = 0;
      for (const t of TABLAS) {
        try {
          filas += (await client.query('SELECT COUNT(*)::int n FROM "' + t + '" WHERE "contrato"=$1', [viejo])).rows[0].n;
        } catch (e) { /* tabla o columna inexistente */ }
      }
      if (!filas) { saltados.push({ viejo, nuevo, razon: 'el origen ya no existe' }); continue; }

      const [a, b] = [await personasDe(client, viejo), await personasDe(client, nuevo)];
      if (b.size && a.size && ![...a].some((x) => b.has(x))) {
        saltados.push({ viejo, nuevo, razon: 'destino de OTRAS personas' });
        continue;
      }

      // FINANCIEROS: no dejar dos registros para el mismo contrato.
      const fa = (await client.query('SELECT COUNT(*)::int n FROM "FINANCIEROS" WHERE "contrato"=$1', [viejo])).rows[0].n;
      const fb = (await client.query('SELECT COUNT(*)::int n FROM "FINANCIEROS" WHERE "contrato"=$1', [nuevo])).rows[0].n;
      if (fa > 0 && fb > 0) { saltados.push({ viejo, nuevo, razon: 'duplicaría FINANCIEROS (' + fa + '+' + fb + ')' }); continue; }

      plan.push({ viejo, nuevo, filas, motivo });
    }

    console.log('\n=== A CORREGIR: ' + plan.length + ' ===');
    if (plan.length) console.table(plan);
    if (saltados.length) { console.log('\n⚠ SE SALTAN:'); console.table(saltados); }

    if (!APPLY) { console.log('\nEnsayo. Correr con --apply para guardarlo.'); return; }
    if (!plan.length) { console.log('\nNada que aplicar.'); return; }

    let total = 0;
    await client.query('BEGIN');
    try {
      for (const it of plan) {
        for (const t of TABLAS) {
          try {
            total += (await client.query('UPDATE "' + t + '" SET "contrato"=$2 WHERE "contrato"=$1', [it.viejo, it.nuevo])).rowCount;
          } catch (e) {
            if (!/does not exist|cannot update/i.test(e.message)) throw e;
          }
        }
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }

    console.log('\n✓ ' + plan.length + ' contrato(s) corregidos · ' + total + ' fila(s) actualizadas.');
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
