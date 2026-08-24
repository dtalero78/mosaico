/**
 * Asigna un Ejecutivo de Recaudos (`PEOPLE.gestorRecaudo`) a un lote de titulares.
 *
 * Recibe un CSV con los contratos a asignar; sólo toca las filas que YA existen
 * en PEOPLE como TITULAR (las que el CSV traiga y no estén en la base se
 * reportan y se saltan).
 *
 * El número de contrato del CSV puede venir en la forma corta anterior
 * (`5-2341-26`); se compara por el NÚCLEO —consecutivo y año, sin país ni
 * segmento— igual que el verificador: `5-2341-26` == `01-M5-2341-26`.
 *
 * Uso:
 *   node scripts/asignar-gestor-recaudo-lote.js --csv=archivo.csv --gestor=correo [--apply] [--override]
 *
 *   --csv       CSV con columnas item;mes;titular;contrato;rut (sin encabezado)
 *               o el `verificacion-contratos.csv` que produce el verificador.
 *   --gestor    correo del usuario en USUARIOS_ROLES (rol RECAUDOS_*, activo).
 *   --apply     escribe. Sin este flag es un ensayo.
 *   --override  reasigna también a los que YA tienen otro ejecutivo.
 *               Por defecto esos se respetan y se reportan.
 */
const fs = require('fs');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').split('=')[1];
const APPLY = process.argv.includes('--apply');
const OVERRIDE = process.argv.includes('--override');
const CSV = arg('csv');
const GESTOR = arg('gestor');

if (!CSV || !GESTOR) {
  console.error('\n  Uso: node scripts/asignar-gestor-recaudo-lote.js --csv=archivo.csv --gestor=correo [--apply] [--override]\n');
  process.exit(1);
}

const normId = (v) => String(v || '').toUpperCase().replace(/[.\s\-_]/g, '');
const normCon = (v) => String(v || '').toUpperCase().replace(/\s/g, '');

/** `01-M5-2341-26` → `2341-26` · `5-2341-26` → `2341-26` · `6-103-26` → `103-26` */
function nucleo(v) {
  let s = normCon(v).replace(/^0?[1-9]-(?=[MI][56]-)/, '');
  s = s.replace(/^[MI][56]-/, '');
  return s.replace(/^0?[56]-/, '');
}

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  // 1. Resolver el ejecutivo.
  const g = (await pool.query(
    `SELECT "_id", TRIM(CONCAT_WS(' ', "nombre", "apellido")) AS nombre, "rol", "activo", "plataforma"
       FROM "USUARIOS_ROLES" WHERE LOWER(TRIM("email")) = LOWER(TRIM($1))`, [GESTOR]
  )).rows[0];
  if (!g) { console.error(`\n  No existe el usuario ${GESTOR}.\n`); process.exit(1); }
  if (!['RECAUDOS_ASESOR', 'RECAUDOS_JEFE', 'RECAUDO_ASIST'].includes(g.rol)) {
    console.error(`\n  ${g.nombre} tiene rol ${g.rol}; el ejecutivo debe ser de Recaudos.\n`); process.exit(1);
  }
  if (!g.activo) { console.error(`\n  ${g.nombre} está inactivo.\n`); process.exit(1); }

  // 2. Leer el CSV. Acepta el formato del verificador (con encabezado) o el simple.
  const lineas = fs.readFileSync(CSV, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const conEncabezado = /contrato/i.test(lineas[0]) && /rut|item/i.test(lineas[0]);
  const filas = lineas.slice(conEncabezado ? 1 : 0).map((l) => {
    const c = l.split(';');
    return { titular: c[2], contrato: (c[3] || '').trim(), rut: c[4], resultado: c[5] || '' };
  }).filter((f) => f.contrato || f.rut);

  // 3. Índice de titulares por documento.
  const rows = (await pool.query(
    `SELECT "_id", "numeroId", "contrato", "gestorRecaudo",
            TRIM(CONCAT_WS(' ', "primerNombre", "primerApellido")) nom
       FROM "PEOPLE" WHERE "tipoUsuario" = 'TITULAR'`
  )).rows;
  const porId = new Map(), porNucleo = new Map();
  for (const r of rows) {
    const i = normId(r.numeroId);
    if (i) { if (!porId.has(i)) porId.set(i, []); porId.get(i).push(r); }
    const k = nucleo(r.contrato);
    if (k) { if (!porNucleo.has(k)) porNucleo.set(k, []); porNucleo.get(k).push(r); }
  }
  const gestores = new Map((await pool.query(
    `SELECT "_id", TRIM(CONCAT_WS(' ', "nombre", "apellido")) AS nombre FROM "USUARIOS_ROLES"`
  )).rows.map((r) => [r._id, r.nombre]));

  const R = { asignar: [], yaTiene: [], yaEsEl: [], noExiste: [], porContrato: [] };
  for (const f of filas) {
    const cands = porId.get(normId(f.rut)) || [];
    let t = cands.find((r) => nucleo(r.contrato) === nucleo(f.contrato)) || cands[0];
    // Respaldo: si el documento del listado no resuelve (viene truncado o con un
    // typo), se busca por el número de contrato, que es único. Se reporta aparte
    // para que quede a la vista que la coincidencia no fue por documento.
    if (!t) {
      const porNum = porNucleo.get(nucleo(f.contrato)) || [];
      if (porNum.length === 1) { t = porNum[0]; R.porContrato.push({ f, t }); }
    }
    if (!t) { R.noExiste.push(f); continue; }
    if (t.gestorRecaudo === g._id) R.yaEsEl.push({ f, t });
    else if (t.gestorRecaudo) (OVERRIDE ? R.asignar : R.yaTiene).push({ f, t });
    else R.asignar.push({ f, t });
  }

  console.log(`\n  Ejecutivo: ${g.nombre}  (${GESTOR} · ${g.rol} · ${g.plataforma || 'sin plataforma'})`);
  console.log(`  Listado: ${filas.length} fila(s) de ${CSV}\n`);
  console.log(`  → se asignarán ................... ${String(R.asignar.length).padStart(4)}`);
  console.log(`    ya lo tienen asignado .......... ${String(R.yaEsEl.length).padStart(4)}`);
  console.log(`    tienen OTRO ejecutivo .......... ${String(R.yaTiene.length).padStart(4)}${OVERRIDE ? '  (se reasignan por --override)' : '  (se respetan)'}`);
  console.log(`    no existen en PEOPLE ........... ${String(R.noExiste.length).padStart(4)}`);

  if (R.porContrato.length) {
    console.log('\n  Resueltos por el N° de contrato — el documento del listado no coincide:');
    R.porContrato.forEach(({ f, t }) => console.log(`    ${String(t.contrato).padEnd(18)}${String(t.nom).slice(0, 30).padEnd(32)}listado: ${f.rut}   base: ${t.numeroId}`));
  }

  if (R.yaTiene.length && !OVERRIDE) {
    console.log('\n  Con otro ejecutivo (no se tocan):');
    R.yaTiene.forEach(({ t }) => console.log(`    ${String(t.contrato).padEnd(18)}${String(t.nom).slice(0, 30).padEnd(32)}${gestores.get(t.gestorRecaudo) || t.gestorRecaudo}`));
  }

  if (!APPLY) { console.log('\n  Ensayo. Correr con --apply para guardarlo.\n'); await pool.end(); return; }

  const ids = R.asignar.map(({ t }) => t._id);
  if (!ids.length) { console.log('\n  Nada que asignar.\n'); await pool.end(); return; }
  const upd = await pool.query(
    `UPDATE "PEOPLE" SET "gestorRecaudo" = $1, "_updatedDate" = NOW() WHERE "_id" = ANY($2)`,
    [g._id, ids]
  );
  console.log(`\n  ${upd.rowCount} titular(es) asignados a ${g.nombre}.\n`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
