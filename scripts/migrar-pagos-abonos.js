/**
 * Pagos en abonos (nov-2026, portado de LGS; respaldos en .mosaico-tmp/, gitignored) — separa "N° de pago" de "cuota aplicada".
 *
 *   --fase=columnas   Agrega PAGOS_TITULARES."numPago" (INTEGER) y "abono"
 *                     (BOOLEAN NOT NULL DEFAULT false). Correr ANTES de desplegar:
 *                     el INSERT del código nuevo ya escribe esas columnas.
 *   --fase=datos      (por defecto)
 *                     1. Renumera "numCuota" (cada pago, en orden de fecha, pasa a la
 *                        primera cuota que no esté completa) en los contratos con
 *                        pagos numerados por encima del plan, o cuya numeración empieza
 *                        en la 1 y deja cuotas a medias con pagos en cuotas posteriores
 *                        (abonos numerados como cuotas). Si empieza después de la 1 no
 *                        se toca: las cuotas previas se pagaron fuera de la plataforma.
 *                     2. Llena "numPago" (1..n por titular, en orden de fecha) donde falte.
 *                     3. Calcula "abono" con la regla de src/lib/cuotas-pagos.ts.
 *                     4. Recalcula FINANCIEROS."cuotasPagadas" = cuotas COMPLETAS con
 *                        los pagos validados (antes contaba filas).
 *
 * Dry-run por defecto; escribe con --apply (transacción + respaldo JSON en docs/).
 * Uso: node scripts/migrar-pagos-abonos.js [--fase=columnas|datos] [--apply] [--contrato=X]
 *
 * La asignación replica asignarPagos()/simularPago() de src/lib/cuotas-pagos.ts:
 * cada pago cubre valorPagado + descuento, empieza en su cuota y desborda hacia
 * adelante; nunca rellena hacia atrás.
 */
require('dotenv').config({ path: '.env.local', quiet: true });
const fs = require('fs');
fs.mkdirSync('.mosaico-tmp', { recursive: true }); // gitignored: respaldos con datos de clientes
const path = require('path');
const { Client } = require('pg');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FASE = (args.find(a => a.startsWith('--fase=')) || '--fase=datos').split('=')[1];
const SOLO = (args.find(a => a.startsWith('--contrato=')) || '').split('=')[1] || null;
// (b) "abonos numerados como cuotas" solo con --renumerar-abonos (revisión de Recaudos).
const RENUMERAR_ABONOS = args.includes('--renumerar-abonos');

function monto(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/[^\d.,-]/g, '');
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
const ts = v => { if (!v) return 0; const t = new Date(v).getTime(); return Number.isNaN(t) ? 0 : t; };
const cuotaDe = p => {
  let k = p.numCuota == null ? NaN : Number(p.numCuota);
  if ((Number.isNaN(k) || k < 0) && (p.inscripcion === true || monto(p.inscripcion) > 0)) k = 0;
  return Number.isNaN(k) ? 0 : Math.max(0, Math.floor(k));
};
const porFecha = (a, b) => (ts(a.fechaPago) - ts(b.fechaPago)) || (ts(a._createdDate) - ts(b._createdDate));

function nuevasCuotas(plan) {
  return [plan.inscripcion, ...Array.from({ length: plan.numeroCuotas }, () => plan.valorCuota)]
    .map(valor => ({ valor, cubierto: 0, aportes: 0 }));
}
/** Aplica un pago sobre las cuotas (muta). Devuelve si fue abono. */
function aplicar(cuotas, p) {
  const start = Math.min(cuotaDe(p), cuotas.length - 1);
  let restante = monto(p.valorPagado) + monto(p.descuento);
  let abono = false;
  let i = start;
  while (restante > 0.5 && i < cuotas.length) {
    const c = cuotas[i];
    const falta = c.valor - c.cubierto;
    if (falta <= 0.5) { i++; continue; }
    if (c.cubierto > 0.5) abono = true;               // la cuota ya tenía abonos
    const aplica = Math.min(restante, falta);
    c.cubierto += aplica; c.aportes++; restante -= aplica;
    if (c.cubierto < c.valor - 0.5) abono = true;     // la deja incompleta
    else i++;
  }
  // Lo que sobra al final del contrato tapa cuotas que quedaron cortas (igual que la lib).
  for (let j = start - 1; j >= 1 && restante > 0.5; j--) {
    const falta = cuotas[j].valor - cuotas[j].cubierto;
    if (falta <= 0.5) continue;
    const aplica = Math.min(restante, falta);
    cuotas[j].cubierto += aplica; restante -= aplica;
  }
  return abono;
}
function asignar(plan, pagos) {
  const cuotas = nuevasCuotas(plan);
  const orden = [...pagos].sort((a, b) => (cuotaDe(a) - cuotaDe(b)) || porFecha(a, b));
  for (const p of orden) aplicar(cuotas, p);
  return cuotas;
}
const completas = cuotas => cuotas.slice(1).filter(c => c.cubierto >= c.valor - 0.5).length;
/** Primera cuota incompleta desde `desde` (la primera registrada en la plataforma). */
const primeraIncompleta = (cuotas, desde = 1) => {
  for (let i = Math.max(1, desde); i < cuotas.length; i++) if (cuotas[i].cubierto < cuotas[i].valor - 0.5) return i;
  return null;
};

(async () => {
  const dbu = new URL(process.env.DATABASE_URL); dbu.searchParams.delete('sslmode');
  const c = new Client({ connectionString: dbu.toString(), ssl: { rejectUnauthorized: false } });
  await c.connect();

  if (FASE === 'columnas') {
    const sql = [
      `ALTER TABLE "PAGOS_TITULARES" ADD COLUMN IF NOT EXISTS "numPago" INTEGER`,
      `ALTER TABLE "PAGOS_TITULARES" ADD COLUMN IF NOT EXISTS "abono" BOOLEAN NOT NULL DEFAULT false`,
    ];
    for (const s of sql) console.log((APPLY ? 'APLICA: ' : 'DRY-RUN: ') + s);
    if (APPLY) { await c.query("SET lock_timeout = '5s'"); for (const s of sql) await c.query(s); }
    await c.end();
    return;
  }

  const tieneCols = (await c.query(`SELECT COUNT(*)::int n FROM information_schema.columns
    WHERE table_name='PAGOS_TITULARES' AND column_name IN ('numPago','abono')`)).rows[0].n === 2;
  if (!tieneCols) { console.error('Faltan las columnas: correr primero --fase=columnas --apply'); process.exit(1); }

  const tit = (await c.query(`
    SELECT p."_id", p."contrato", f."_id" AS fin_id, f."valorCuota", f."numeroCuotas", f."pagoInscripcion", f."cuotasPagadas"
      FROM "PEOPLE" p
      LEFT JOIN LATERAL (SELECT * FROM "FINANCIEROS" f WHERE f."contrato" = p."contrato" ORDER BY f."_createdDate" DESC LIMIT 1) f ON true
     WHERE p."_id" IN (SELECT DISTINCT "idPeople" FROM "PAGOS_TITULARES")
       ${SOLO ? `AND p."contrato" = $1` : ''}`, SOLO ? [SOLO] : [])).rows;
  const pagosRows = (await c.query(`
    SELECT "_id","idPeople","numCuota","numPago","abono","fechaPago","_createdDate","valorPagado","descuento","inscripcion","validado"
      FROM "PAGOS_TITULARES" WHERE "idPeople" = ANY($1::text[])`, [tit.map(t => t._id)])).rows;
  const pagosDe = new Map();
  for (const p of pagosRows) (pagosDe.get(p.idPeople) || pagosDe.set(p.idPeople, []).get(p.idPeople)).push(p);

  const cambios = [];          // { pagoId, contrato, antes:{}, despues:{} }
  const finCambios = [];       // { finId, contrato, antes, despues }
  const renumerados = [];
  let sinPlan = 0;

  for (const t of tit) {
    const pagos = pagosDe.get(t._id) || [];
    const plan = { inscripcion: monto(t.pagoInscripcion), valorCuota: monto(t.valorCuota), numeroCuotas: Number(t.numeroCuotas) || 0 };
    const conPlan = plan.valorCuota > 0 && plan.numeroCuotas > 0;
    if (!conPlan) sinPlan++;
    const nuevo = new Map(pagos.map(p => [p._id, { numCuota: p.numCuota, numPago: p.numPago, abono: p.abono }]));
    const cuotasPag = pagos.filter(p => Number(p.numCuota) > 0).sort(porFecha);

    // 1. Renumerar: (a) cuotas por encima del plan, o (b) numeración que empieza
    //    en la 1 y deja una cuota a medias con pagos en cuotas posteriores (abonos
    //    numerados como cuotas). Si empieza después de la 1 NO se toca: las cuotas
    //    previas se pagaron por fuera de la plataforma.
    const maxCuota = cuotasPag.reduce((m, p) => Math.max(m, Number(p.numCuota)), 0);
    const minCuota = cuotasPag.reduce((m, p) => Math.min(m, Number(p.numCuota)), Infinity);
    let motivo = null;
    if (conPlan && maxCuota > plan.numeroCuotas) motivo = 'excede plan';
    else if (conPlan && minCuota === 1 && RENUMERAR_ABONOS) {
      const act = asignar(plan, pagos);
      for (let i = 1; i < act.length && !motivo; i++) {
        if (act[i].cubierto < act[i].valor - 0.5 && act.slice(i + 1).some(x => x.cubierto > 0.5)) motivo = 'abonos numerados como cuotas';
      }
    }
    if (motivo) {
      const cuotas = nuevasCuotas(plan);
      for (const p of pagos.filter(x => cuotaDe(x) === 0)) aplicar(cuotas, p);
      for (const p of cuotasPag) {
        const k = primeraIncompleta(cuotas, minCuota) ?? plan.numeroCuotas;
        nuevo.get(p._id).numCuota = k;
        aplicar(cuotas, { ...p, numCuota: k });
      }
      renumerados.push({ contrato: t.contrato, motivo, pagos: cuotasPag.length, maxAntes: maxCuota, plan: plan.numeroCuotas,
        cambian: cuotasPag.filter(p => nuevo.get(p._id).numCuota !== p.numCuota).length });
    }

    // 2. N° de pago (solo cuotas), donde falte.
    let n = cuotasPag.reduce((m, p) => Math.max(m, Number(p.numPago) || 0), 0);
    for (const p of cuotasPag) if (p.numPago == null) nuevo.get(p._id).numPago = ++n;

    // 3. Abono: cada pago contra los registrados ANTES que él (orden de fecha).
    if (conPlan) {
      const previos = [];
      for (const p of [...pagos].sort(porFecha)) {
        const pp = { ...p, numCuota: nuevo.get(p._id).numCuota };
        const cuotas = asignar(plan, previos);
        nuevo.get(p._id).abono = cuotaDe(pp) > 0 ? aplicar(cuotas, pp) : false;
        previos.push(pp);
      }
    }

    for (const p of pagos) {
      const d = nuevo.get(p._id);
      const antes = {}, despues = {};
      for (const k of ['numCuota', 'numPago', 'abono']) {
        if ((p[k] ?? null) !== (d[k] ?? null)) { antes[k] = p[k] ?? null; despues[k] = d[k] ?? null; }
      }
      if (Object.keys(despues).length) cambios.push({ pagoId: p._id, contrato: t.contrato, antes, despues });
    }

    // 4. FINANCIEROS.cuotasPagadas = cuotas completas con los VALIDADOS.
    if (conPlan && t.fin_id) {
      const validados = pagos.filter(p => p.validado === true).map(p => ({ ...p, numCuota: nuevo.get(p._id).numCuota }));
      const cp = completas(asignar(plan, validados));
      if ((t.cuotasPagadas ?? null) !== cp) finCambios.push({ finId: t.fin_id, contrato: t.contrato, antes: t.cuotasPagadas ?? null, despues: cp });
    }
  }

  const cuenta = k => cambios.filter(x => k in x.despues).length;
  console.log(`Titulares con pagos: ${tit.length} (sin plan en FINANCIEROS: ${sinPlan})`);
  console.log(`Contratos renumerados: ${renumerados.length}`);
  if (renumerados.length) console.table(renumerados.length > 30 ? renumerados.filter(r => r.motivo === 'excede plan') : renumerados);
  if (RENUMERAR_ABONOS && !APPLY) {
    // Lista para que Recaudos revise los casos (b) antes de aplicar (CSV gitignored).
    const csv = path.join('.mosaico-tmp', `pagos-abonos-renumerar-${new Date().toISOString().slice(0, 10)}.csv`);
    const filas = renumerados.map(r => {
      const det = cambios.filter(x => x.contrato === r.contrato && 'numCuota' in x.despues)
        .map(x => `${x.antes.numCuota}->${x.despues.numCuota}`).join(' ');
      return [r.contrato, r.motivo, r.pagos, r.maxAntes, r.plan, r.cambian, det].join(';');
    });
    fs.writeFileSync(csv, '﻿contrato;motivo;pagos;cuota max actual;cuotas plan;pagos que cambian;cambios\n' + filas.join('\n'));
    console.log(`Lista para revisión: ${csv}`);
  }
  console.log(`Pagos con cambio de cuota: ${cuenta('numCuota')} · N° de pago asignado: ${cuenta('numPago')} · marcados abono: ${cambios.filter(x => x.despues.abono === true).length}`);
  console.log(`FINANCIEROS.cuotasPagadas corregido: ${finCambios.length}`);
  console.table(finCambios.slice(0, 10));
  if (SOLO) console.table(cambios.map(x => ({ pago: x.pagoId, ...Object.fromEntries(Object.keys(x.despues).map(k => [k, `${x.antes[k]} → ${x.despues[k]}`])) })));

  if (!APPLY) { console.log('\nDRY-RUN: nada escrito. Repetir con --apply.'); await c.end(); return; }

  const backup = path.join('.mosaico-tmp', `backup-pagos-abonos-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify({ fecha: new Date().toISOString(), cambios, finCambios }, null, 1));
  console.log(`Respaldo: ${backup}`);
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL statement_timeout = 0');
    for (const x of cambios) {
      const sets = [], vals = [x.pagoId];
      for (const [k, v] of Object.entries(x.despues)) { vals.push(v); sets.push(`"${k}" = $${vals.length}`); }
      await c.query(`UPDATE "PAGOS_TITULARES" SET ${sets.join(', ')}, "_updatedDate" = NOW() WHERE "_id" = $1`, vals);
    }
    for (const f of finCambios) {
      await c.query(`UPDATE "FINANCIEROS" SET "cuotasPagadas" = $2, "_updatedDate" = NOW() WHERE "_id" = $1`, [f.finId, f.despues]);
    }
    await c.query('COMMIT');
    console.log(`APLICADO: ${cambios.length} pagos, ${finCambios.length} FINANCIEROS.`);
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('ROLLBACK:', e.message);
    process.exitCode = 1;
  }
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
