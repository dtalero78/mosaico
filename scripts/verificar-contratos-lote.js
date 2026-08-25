/**
 * Verifica si un listado de contratos existe en `PEOPLE`.
 *
 * Compara por el DOCUMENTO del titular y por el NÚCLEO del número de contrato
 * —el consecutivo y el año, sin país ni segmento— porque los listados traen la
 * forma corta anterior: `5-2341-26` es el mismo que `01-M5-2341-26` en la base.
 * Los RUT se normalizan quitando puntos, espacios y guiones.
 *
 * Uso:
 *   node scripts/verificar-contratos-lote.js --csv=archivo.csv [--salida=resultado.csv]
 *
 *   El CSV es `item;mes;titular;contrato;rut` (con o sin encabezado).
 *
 * Resultados por fila:
 *   EXISTE                → documento y contrato coinciden
 *   EXISTE_ANO_DISTINTO   → mismo consecutivo, año distinto (típico error de tipeo)
 *   ID_CON_OTRO_CONTRATO  → el documento está, pero con otro número de contrato
 *   CONTRATO_CON_OTRO_ID  → el contrato está, pero a nombre de otro documento
 *   NO_EXISTE             → no está ni el documento ni el contrato
 */
const fs = require('fs');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').split('=')[1];
const CSV = arg('csv');
const SALIDA = arg('salida') || 'verificacion-contratos.csv';
if (!CSV) {
  console.error('\n  Uso: node scripts/verificar-contratos-lote.js --csv=archivo.csv [--salida=resultado.csv]\n');
  process.exit(1);
}

const normId = (v) => String(v || '').toUpperCase().replace(/[.\s\-_]/g, '');
const normCon = (v) => String(v || '').toUpperCase().replace(/\s/g, '');

/**
 * Núcleo del número: `<consecutivo>-<año>`, sin país ni segmento.
 *   `01-M5-2341-26` · `5-2341-26` · `FI 5-2127-25` → `2341-26` / `2127-25`
 *
 * Se toman los DOS últimos grupos separados por guión en vez de recortar prefijos:
 * los listados traen formas que ningún prefijo fijo cubre ("FI 5-…", "05-…").
 * Si el año arrastra una letra (`5-2454-26 A`), la letra vuelve al consecutivo,
 * que es donde la pone la base (`01-M5-2454A-26`): distingue dos contratos que
 * comparten número.
 */
function nucleo(v) {
  const p = normCon(v).split('-').filter(Boolean);
  if (p.length < 2) return normCon(v);
  let [num, ano] = p.slice(-2);
  const letra = (ano.match(/[A-Z]+$/) || [''])[0];
  if (letra) { ano = ano.slice(0, -letra.length); num += letra; }
  return `${num}-${ano}`;
}
/** El consecutivo sin el año, para detectar diferencias sólo de año. */
const consecutivo = (v) => nucleo(v).replace(/-\d{1,2}$/, '');

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const lineas = fs.readFileSync(CSV, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const hayEncabezado = /titular/i.test(lineas[0]) || /matricula|contrato/i.test(lineas[0]);
  const filas = lineas.slice(hayEncabezado ? 1 : 0).map((l) => {
    const c = l.split(';');
    return { item: c[0], mes: (c[1] || '').trim(), titular: c[2], contrato: (c[3] || '').trim(), rut: c[4] };
  }).filter((f) => f.contrato || f.rut);

  const rows = (await pool.query(
    `SELECT "_id","numeroId","contrato","aprobacion","estado",
            TRIM(CONCAT_WS(' ',"primerNombre","segundoNombre","primerApellido","segundoApellido")) nom
       FROM "PEOPLE" WHERE "tipoUsuario"='TITULAR'`
  )).rows;
  const porId = new Map(), porNucleo = new Map();
  for (const r of rows) {
    const i = normId(r.numeroId);
    if (i) { if (!porId.has(i)) porId.set(i, []); porId.get(i).push(r); }
    const k = nucleo(r.contrato);
    if (k) { if (!porNucleo.has(k)) porNucleo.set(k, []); porNucleo.get(k).push(r); }
  }

  const R = { ok: [], casi: [], otroContrato: [], otroId: [], no: [] };
  for (const f of filas) {
    const porRut = porId.get(normId(f.rut)) || [];
    const n = nucleo(f.contrato), c = consecutivo(f.contrato);
    const exacto = porRut.find((r) => nucleo(r.contrato) === n);
    const casi = porRut.find((r) => consecutivo(r.contrato) === c);
    const porNum = porNucleo.get(n) || [];
    if (exacto) R.ok.push({ ...f, db: exacto });
    else if (casi) R.casi.push({ ...f, db: casi });
    else if (porRut.length) R.otroContrato.push({ ...f, db: porRut[0] });
    else if (porNum.length) R.otroId.push({ ...f, db: porNum[0] });
    else R.no.push(f);
  }

  const est = (r) => (r.aprobacion || r.estado || 'sin estado');
  console.log(`\n  ${filas.length} contratos del listado · ${rows.length} titulares en PEOPLE\n`);
  console.log(`  ✓ Existen, documento y contrato coinciden .. ${String(R.ok.length).padStart(3)}`);
  console.log(`  ~ Existen, mismo N° pero año distinto ...... ${String(R.casi.length).padStart(3)}`);
  console.log(`  ⚠ El documento está, con OTRO contrato ..... ${String(R.otroContrato.length).padStart(3)}`);
  console.log(`  ⚠ El contrato está, con OTRO documento ..... ${String(R.otroId.length).padStart(3)}`);
  console.log(`  ✗ NO existen ............................... ${String(R.no.length).padStart(3)}`);

  const tabla = (arr, titulo) => {
    if (!arr.length) return;
    console.log('\n  ── ' + titulo + ' ──');
    console.log('    #    titular                         listado        en la base        documento    estado');
    arr.forEach((x) => console.log('    ' + String(x.item).padStart(3) + '  ' + String(x.titular).slice(0, 30).padEnd(32) +
      String(x.contrato).padEnd(15) + '→ ' + String(x.db?.contrato || '—').padEnd(18) +
      String(x.db?.numeroId || '').padEnd(13) + (x.db ? est(x.db) : '')));
  };
  tabla(R.casi, 'Mismo número, año distinto');
  tabla(R.otroContrato, 'El documento existe, pero con otro contrato');
  tabla(R.otroId, 'El contrato existe, pero con otro documento');

  if (R.no.length) {
    console.log('\n  ── NO existen en PEOPLE (' + R.no.length + ') ──');
    console.log('    #    mes         titular                              contrato        documento');
    R.no.forEach((x) => console.log('    ' + String(x.item).padStart(3) + '  ' + String(x.mes).padEnd(11) +
      String(x.titular).slice(0, 36).padEnd(38) + String(x.contrato).padEnd(16) + x.rut));
    const porMes = {}; R.no.forEach((x) => { porMes[x.mes] = (porMes[x.mes] || 0) + 1; });
    console.log('\n    por mes: ' + Object.entries(porMes).map(([m, n]) => m + ' ' + n).join(' · '));
  }

  const csv = ['item;mes;titular;contratoListado;rutListado;resultado;contratoEnBase;rutEnBase;titularEnBase;estado'];
  const push = (arr, e) => arr.forEach((x) => csv.push([x.item, x.mes, x.titular, x.contrato, x.rut, e,
    x.db?.contrato || '', x.db?.numeroId || '', x.db?.nom || '', x.db ? est(x.db) : ''].join(';')));
  push(R.ok, 'EXISTE'); push(R.casi, 'EXISTE_ANO_DISTINTO'); push(R.otroContrato, 'ID_CON_OTRO_CONTRATO');
  push(R.otroId, 'CONTRATO_CON_OTRO_ID'); push(R.no, 'NO_EXISTE');
  fs.writeFileSync(SALIDA, '﻿' + csv.join('\n'), 'utf8');
  console.log('\n  Detalle completo → ' + SALIDA + '\n');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
