/**
 * import-libro-produccion.js — carga ÚNICA desde una pestaña del Libro de Producción de MOSAICO
 * (Google Sheets exportada a CSV). Llena lo que aún no existe en la plataforma para los
 * contratos ya creados: filial (= nombre de la pestaña), origen de matrícula y la escalera
 * comercial (Full Executive, Jefe de grupo, Gerente, Gerente división, Sales Manager).
 * También pone la filial al asesor en EQUIPO_COMERCIAL (si no la tenía) para los contratos nuevos.
 *
 * Columnas ubicadas por NOMBRE. Cruce por N° de contrato contra el TITULAR (exacto, o por su
 * núcleo numérico, p. ej. 5-2928-26 ≈ 01-M5-02928-26). Nunca pisa un dato existente.
 * Dry-run por defecto; --apply escribe en una transacción.
 *
 * Uso: node scripts/import-libro-produccion.js --csv=ruta.csv --filial=PITAGORA [--apply]
 */
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const { Client } = require('pg');
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
const APPLY = process.argv.includes('--apply');
// --solo-origen: sólo origen de matrícula (para pestañas con nombres de escalera cortados, p. ej. Perú).
const SOLO_ORIGEN = process.argv.includes('--solo-origen');
const ruta = arg('csv'); const filial = arg('filial').trim().toUpperCase();
if (!ruta || !filial) { console.error('Faltan --csv=ruta y --filial=NOMBRE'); process.exit(1); }

function parseCsv(txt) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (q) { if (ch === '"' && txt[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(cur); cur = ''; } else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const norm = (s) => String(s || '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
const limpio = (v) => { const s = String(v || '').replace(/\s+/g, ' ').trim(); return !s || /^(N\/?A|NA|-|PENDIENTE)$/i.test(s) ? null : s; };
const idNorm = (v) => String(v || '').toUpperCase().replace(/[^0-9K]/g, '').replace(/^0+/, '');
const nucleo = (c) => { const m = String(c || '').match(/(\d{3,6})-(\d{2})\s*$/); return m ? `${parseInt(m[1], 10)}-${m[2]}` : null; };

const rows = parseCsv(fs.readFileSync(ruta, 'utf8'));
const hdr = rows.findIndex((r) => r.some((c) => norm(c).startsWith('N° CONTRATO') || norm(c).startsWith('N CONTRATO')));
if (hdr < 0) { console.error('No encontré la fila de encabezado (N° CONTRATO).'); process.exit(1); }
const H = rows[hdr].map(norm);
const col = (...names) => H.findIndex((h) => names.some((n) => h.startsWith(n)));
const C = {
  contrato: col('N° CONTRATO', 'N CONTRATO'), fe: col('FULL EXEC'), jg: col('JEFE DE'), ge: col('GERENTE'),
  gd: col('GERENTE DIV'), sm: col('SALES MAN'), ori: col('ORIGEN'), rut: col('RUT  TIT', 'RUT TIT'),
};
// "GERENTE" también es prefijo de "GERENTE DIVISIONAL": el simple es el primero que NO es división.
C.ge = H.findIndex((h) => h === 'GERENTE');
console.log('Columnas:', JSON.stringify(C));

const datos = rows.slice(hdr + 1).map((r) => ({
  contrato: limpio(r[C.contrato]), rut: limpio(r[C.rut]), fullExecutive: limpio(r[C.fe]), jefeGrupo: limpio(r[C.jg]), gerente: limpio(r[C.ge]),
  gerenteDivision: limpio(r[C.gd]), salesManager: limpio(r[C.sm]), origen: limpio(r[C.ori]),
})).filter((d) => d.contrato && /\d{3,}/.test(d.contrato));
console.log(`Filas con contrato: ${datos.length} (filial ${filial})`);

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });
  await c.connect();
  const tit = (await c.query(`SELECT "_id","contrato","numeroId","fullExecutive","jefeGrupo","gerente","gerenteDivision","salesManager","filial","origenMatricula","asesorMail"
     FROM "PEOPLE" WHERE "tipoUsuario"='TITULAR' AND "contrato" NOT LIKE 'PRB-%'`)).rows;
  const porExacto = new Map(tit.map((t) => [String(t.contrato).trim(), t]));
  const porNucleo = new Map(); tit.forEach((t) => { const k = nucleo(t.contrato); if (k) porNucleo.set(k, [...(porNucleo.get(k) || []), t]); });
  const porRut = new Map(); tit.forEach((t) => { const k = idNorm(t.numeroId); if (k) porRut.set(k, [...(porRut.get(k) || []), t]); });
  let ok = 0, sinMatch = [], ambiguo = [], cambios = [];
  for (const d of datos) {
    let t = porExacto.get(d.contrato);
    // Respaldo: cédula del titular (el contrato pudo renumerarse al migrarlo, p. ej. 5-2928-26 → 04-M5-09000-26).
    if (!t && d.rut) { const l = porRut.get(idNorm(d.rut)) || []; if (l.length === 1) t = l[0]; }
    if (!t) { const l = porNucleo.get(nucleo(d.contrato)) || []; if (l.length === 1) t = l[0]; else if (l.length > 1) { ambiguo.push(d.contrato); continue; } }
    if (!t) { sinMatch.push(d.contrato); continue; }
    const set = {};
    const poner = (campo, v) => { if (v && !String(t[campo] || '').trim()) set[campo] = v; };
    if (!SOLO_ORIGEN) {
      poner('fullExecutive', d.fullExecutive); poner('jefeGrupo', d.jefeGrupo); poner('gerente', d.gerente);
      poner('gerenteDivision', d.gerenteDivision); poner('salesManager', d.salesManager);
      poner('filial', filial);
    }
    poner('origenMatricula', d.origen);
    if (Object.keys(set).length) cambios.push({ id: t._id, contrato: t.contrato, asesorMail: t.asesorMail, set }); ok++;
  }
  console.log(`Cruzados: ${ok} · con cambios: ${cambios.length} · sin match: ${sinMatch.length} · ambiguos: ${ambiguo.length}`);
  if (sinMatch.length) console.log('Sin match:', sinMatch.join(', '));
  if (ambiguo.length) console.log('Ambiguos:', ambiguo.join(', '));
  if (!APPLY) { console.log('\n[dry-run] ejemplo:', JSON.stringify(cambios.slice(0, 2), null, 1), '\nUsa --apply para escribir.'); await c.end(); return; }
  await c.query('BEGIN');
  try {
    for (const k of cambios) {
      const cols = Object.keys(k.set);
      await c.query(`UPDATE "PEOPLE" SET ${cols.map((x, i) => `"${x}"=$${i + 2}`).join(', ')}, "_updatedDate"=NOW() WHERE "_id"=$1`, [k.id, ...cols.map((x) => k.set[x])]);
    }
    // Filial del asesor para los contratos nuevos (sólo si no tenía).
    const correos = [...new Set(cambios.map((k) => String(k.asesorMail || '').trim().toLowerCase()).filter(Boolean))];
    const r = correos.length ? await c.query(`UPDATE "EQUIPO_COMERCIAL" SET "filial"=$1,"_updatedDate"=NOW()
        WHERE LOWER(TRIM("correo")) = ANY($2) AND COALESCE(TRIM("filial"),'')=''`, [filial, correos]) : { rowCount: 0 };
    await c.query('COMMIT');
    console.log(`✔ ${cambios.length} titulares actualizados · ${r.rowCount} asesores con filial`);
  } catch (e) { await c.query('ROLLBACK'); throw e; }
  await c.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
