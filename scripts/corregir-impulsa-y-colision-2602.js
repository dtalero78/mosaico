/**
 * Dos correcciones puntuales de numero de contrato que no se pueden deducir del
 * propio texto: hay que saber a que producto pertenece el contrato y quien es
 * quien. Por eso van escritas a mano y no por regla, como los pares de
 * `corregir-contratos-desincronizados.js`.
 *
 * (1) IMPULSA. El segmento del numero identifica el producto: `M5` es MOSAICO e
 *     `I6` es IMPULSA. Dos contratos de IMPULSA quedaron guardados con `M6`
 *     —producto equivocado— y ademas sus alumnos seguian en ACADEMICA con el
 *     numero corto (`6-115-26`). Los dos lados van al mismo canonico `01-I6-…`.
 *     Verificado antes de escribir: las personas de PEOPLE y ACADEMICA son las
 *     mismas y el alumno cursa IMPULSA.
 *
 * (2) Colision del 2602. Dos familias distintas comparten el consecutivo: Maria
 *     Munoz (firmado 2026-06-03) y BORYS ROBLES (2026-09-09). No es una
 *     desincronizacion —ambos contratos son reales y completos—, asi que el
 *     numero se desdobla con sufijo, como los otros contratos con letra que ya
 *     hay en la base. Se reparte por orden de firma: A al primero, B al segundo.
 *     Renombrar tambien al que ya estaba canonico es a proposito: dejar uno
 *     pelado y otro con letra volveria a insinuar que son el mismo contrato.
 *
 * Re-correrlo despues de aplicado no escribe nada: si los origenes ya no existen
 * y los destinos si, avisa que el trabajo esta hecho y sale limpio. Si en cambio
 * el destino esta ocupado y el origen TAMBIEN sigue vivo, aborta: eso ya no es
 * una segunda corrida sino un choque real que hay que mirar a mano.
 *
 * Uso:
 *   node scripts/corregir-impulsa-y-colision-2602.js           (ensayo)
 *   node scripts/corregir-impulsa-y-colision-2602.js --apply
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const TABLAS = ['PEOPLE', 'ACADEMICA', 'USUARIOS_ROLES', 'FINANCIEROS', 'ACTIVE_STUDENTS', 'auditautoaprov', 'CASOS_ATENCION'];

/** viejo -> nuevo, con el motivo por el que ese destino es el correcto. */
const PARES = [
  ['01-M6-115-26', '01-I6-115-26', 'IMPULSA de Erika Cuevas: el segmento va I6, no M6'],
  ['6-115-26',     '01-I6-115-26', 'Martin Santander, su alumno, al mismo contrato'],
  ['01-M6-124-26', '01-I6-124-26', 'IMPULSA de VIVIANA ABASOLO: el segmento va I6, no M6'],
  ['6-124-26',     '01-I6-124-26', 'BENJAMIN VERGARA, su alumno, al mismo contrato'],
  ['01-M5-2602-26',                     '01-M5-2602A-26', 'Maria Munoz, firmado 2026-06-03'],
  ['Contrato Online N.\u00ba 5-2602-26', '01-M5-2602B-26', 'BORYS ROBLES, firmado 2026-09-09'],
];

/** Destinos que este script crea; ocupados por otro seria un choque real. */
const DESTINOS_NUEVOS = ['01-I6-115-26', '01-I6-124-26', '01-M5-2602A-26', '01-M5-2602B-26'];

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const client = await pool.connect();
  try {
    // Cuantas filas quedan en cada origen. Es lo que decide si hay trabajo.
    const plan = [];
    for (const [viejo, nuevo, motivo] of PARES) {
      let filas = 0;
      for (const t of TABLAS) {
        try {
          filas += (await client.query('SELECT COUNT(*)::int n FROM "' + t + '" WHERE "contrato"=$1', [viejo])).rows[0].n;
        } catch (e) { /* tabla o columna inexistente */ }
      }
      if (filas) plan.push({ viejo, nuevo, filas, motivo });
    }

    // Guarda: ningun destino puede estar ocupado ANTES de escribir. Ocupado con
    // el origen ya vacio significa que el script corrio; ocupado con el origen
    // todavia vivo es un choque de verdad y no se toca nada.
    const ocupados = [];
    for (const d of DESTINOS_NUEVOS) {
      const n = (await client.query('SELECT COUNT(*)::int n FROM "PEOPLE" WHERE "contrato"=$1', [d])).rows[0].n;
      if (n) ocupados.push(d);
    }
    if (ocupados.length && !plan.length) {
      console.log('\nYa estaba aplicado: ' + ocupados.join(', ') + '. Nada que hacer.');
      return;
    }
    if (ocupados.length) {
      throw new Error('el destino "' + ocupados[0] + '" ya tiene filas en PEOPLE y el origen sigue vivo \u2014 revisar a mano');
    }

    console.log('\n=== A CORREGIR: ' + plan.length + ' ===');
    if (plan.length) console.table(plan);

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
            // Una tabla puede ser una vista (ACTIVE_STUDENTS): refleja sola las
            // tablas base, asi que no se puede ni hace falta actualizarla.
            if (!/does not exist|cannot update/i.test(e.message)) throw e;
          }
        }
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }

    console.log('\n\u2713 ' + plan.length + ' cambio(s) \u00b7 ' + total + ' fila(s) actualizadas.');
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error('\u2717', e.message); process.exit(1); });
