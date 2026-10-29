/**
 * Backfill de PEOPLE.campaign en los TITULARES = campaña en que NACIÓ el contrato.
 *
 * Regla: la del PRIMER beneficiario del contrato (por _createdDate) y, de esa, la
 * ORIGINAL: el primer dato histórico que haya entre
 *   - ACADEMICA.cambioAcademicoHistory[0].origen.campaign
 *   - PEOPLE.cupoHistory (la entrada más antigua con campaña)
 * y, si no hay historial, la campaña actual del beneficiario.
 * Sólo llena titulares con campaign NULL (nunca pisa).
 *
 * Uso: node scripts/backfill-campana-titular.js [--csv=ruta] [--apply]   (dry-run por defecto)
 */
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const { Client } = require('pg');
const APPLY = process.argv.includes('--apply');
const csvArg = (process.argv.find(a => a.startsWith('--csv=')) || '').slice(6);

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });
  await c.connect();
  const tit = (await c.query(`SELECT _id, contrato, "primerNombre", "primerApellido" FROM "PEOPLE" WHERE "tipoUsuario"='TITULAR' AND campaign IS NULL AND COALESCE(contrato,'') NOT LIKE 'PRB-%'`)).rows;
  const bens = (await c.query(`
    SELECT p._id, p.contrato, p.campaign, p."_createdDate" cre, p."cupoHistory" ch,
           (SELECT a."cambioAcademicoHistory" FROM "ACADEMICA" a WHERE a."peopleId"=p._id LIMIT 1) cah
      FROM "PEOPLE" p WHERE p."tipoUsuario"='BENEFICIARIO' ORDER BY p."_createdDate"`)).rows;
  const porContrato = new Map();
  for (const b of bens) { if (!porContrato.has(b.contrato)) porContrato.set(b.contrato, []); porContrato.get(b.contrato).push(b); }

  const original = (b) => {
    const cand = [];
    const cah = Array.isArray(b.cah) ? b.cah : [];
    for (const h of cah) if (h?.origen?.campaign) cand.push({ f: h.fecha, camp: h.origen.campaign, fuente: 'cambioAcademico' });
    const ch = Array.isArray(b.ch) ? b.ch : [];
    for (const h of ch) if (h?.campaign && h.accion === 'LIBERADO') cand.push({ f: h.fecha, camp: h.campaign, fuente: 'cupoHistory' });
    cand.sort((x, y) => String(x.f).localeCompare(String(y.f)));
    if (cand.length) return cand[0];
    return b.campaign ? { camp: b.campaign, fuente: 'actual' } : null;
  };

  const plan = [], sinDato = [];
  for (const t of tit) {
    const lista = porContrato.get(t.contrato) || [];
    // primer beneficiario (por creación) con campaña derivable
    let elegido = null, bref = null;
    for (const b of lista) { const o = original(b); if (o) { elegido = o; bref = b; break; } }
    if (!elegido) { sinDato.push(t); continue; }
    const actuales = [...new Set(lista.map(b => b.campaign).filter(Boolean))];
    plan.push({ t, camp: elegido.camp, fuente: elegido.fuente, actuales: actuales.join('|'), difiere: actuales.length && !actuales.includes(elegido.camp) });
  }
  const resumen = {};
  plan.forEach(p => { resumen[p.fuente] = (resumen[p.fuente] || 0) + 1; });
  console.log('titulares sin campaña:', tit.length, '| a llenar:', plan.length, '| sin dato:', sinDato.length);
  console.log('por fuente:', resumen, '| difiere de la actual:', plan.filter(p => p.difiere).length);
  if (csvArg) {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    fs.writeFileSync(csvArg, '\ufeff' + ['titularId;contrato;titular;campañaOriginal;fuente;campañasActualesBenef;difiere'].concat(
      plan.map(p => [p.t._id, p.t.contrato, `${p.t.primerNombre} ${p.t.primerApellido}`, p.camp, p.fuente, p.actuales, p.difiere ? 'SI' : ''].map(esc).join(';'))).join('\n'));
    console.log('CSV:', csvArg);
  }
  if (APPLY) {
    await c.query('BEGIN');
    let n = 0;
    for (const p of plan) { const r = await c.query(`UPDATE "PEOPLE" SET campaign=$2 WHERE _id=$1 AND campaign IS NULL`, [p.t._id, p.camp]); n += r.rowCount; }
    await c.query('COMMIT');
    console.log('actualizados:', n);
  } else console.log('(dry-run: use --apply)');
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
