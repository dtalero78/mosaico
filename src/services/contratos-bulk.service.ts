import 'server-only';
import { query } from '@/lib/postgres';
import { createFullContract, validarNumeroIds, normalizeTipoPlan } from '@/services/contract-creation.service';
import { parseContratosCsv, parseFecha, type ParsedContrato, type ParseOpts } from '@/lib/migrar-contratos-parse';

/**
 * Migración de contratos por lote (Subir Lote → modo Contratos).
 *
 * Reusa la MISMA lógica que `scripts/migrar-contratos-csv.js`:
 *  - parseo/normalización en `@/lib/migrar-contratos-parse` (compartido),
 *  - validación contra la BD (curso existe en la campaña, numeroId/noContrato
 *    no existen en PEOPLE),
 *  - creación con `createFullContract` (la MISMA que Crear/Migrar Contrato),
 *  - post-proceso: fechaContrato real del CSV + finalContrato = fecha + 12 meses,
 *    y logins de 2ºs hermanos que comparten email.
 *
 * `validate()` (dry-run) NO escribe nada; `create()` sólo crea los que no tienen
 * errores bloqueantes (❌).
 */

export interface ContratoResultado {
  contrato: string;
  titular: string;
  campaign: string | null;
  campaignRaw: string;
  beneficiarios: { nombre: string; curso: string | null; horario: string | null; id: string }[];
  titularEsBeneficiario: boolean;
  financial: { totalPlan: string; pagoInscripcion: string; saldo: string; numeroCuotas: string; valorCuota: string; plan: string };
  issues: string[];
  bloqueante: boolean;
  // sólo en create():
  estado?: 'creado' | 'omitido' | 'fallido';
  mensaje?: string;
  beneficiariosCreados?: number;
}

export interface BulkResumen {
  total: number;
  bloqueantes: number;
  observaciones: number;
  creados?: number;
  omitidos?: number;
  fallidos?: number;
  contratos: ContratoResultado[];
}

function toResultado(c: ParsedContrato): ContratoResultado {
  const issues = c._issues || [];
  return {
    contrato: c.contrato,
    titular: `${c.titular.primerNombre || ''} ${c.titular.primerApellido || ''}`.trim(),
    campaign: c.campaign,
    campaignRaw: c.campaignRaw,
    titularEsBeneficiario: c.titularEsBeneficiario,
    beneficiarios: [
      ...(c.titularEsBeneficiario ? [{ nombre: `${c.titular.primerNombre} ${c.titular.primerApellido} (titular)`, curso: c.titular.tipoCurso, horario: c.titular.horarioCurso, id: c.titular.numeroIdRaw }] : []),
      ...c.beneficiarios.map(b => ({ nombre: `${b.primerNombre} ${b.primerApellido}`, curso: b.tipoCurso, horario: b.horarioCurso, id: b.numeroIdRaw })),
    ],
    financial: c.financial,
    issues,
    bloqueante: issues.some(x => x.startsWith('❌')),
  };
}

/** Valida las filas contra la BD. Muta `_issues` en cada contrato. */
async function validarContratos(contratos: ParsedContrato[]): Promise<void> {
  // combos de curso válidos POR campaña
  const cc = await query<{ campaign: string; tipoCurso: string; horarioCurso: string }>(
    `SELECT "campaign","tipoCurso","horarioCurso" FROM "CURSOS_CAMPAIGN"`);
  const cursoPorCampaign = new Map<string, Set<string>>();
  for (const r of cc.rows) {
    if (!cursoPorCampaign.has(r.campaign)) cursoPorCampaign.set(r.campaign, new Set());
    cursoPorCampaign.get(r.campaign)!.add(`${r.tipoCurso}||${r.horarioCurso}`);
  }

  const allIds = [...new Set(contratos.flatMap(c =>
    [c.titular.numeroId, ...c.beneficiarios.map(b => b.numeroId)].filter(Boolean)))] as string[];
  const existentes = new Set<string>();
  if (allIds.length) {
    const ex = await query<{ numeroId: string }>(`SELECT DISTINCT "numeroId" FROM "PEOPLE" WHERE "numeroId" = ANY($1)`, [allIds]);
    ex.rows.forEach(r => existentes.add(r.numeroId));
  }

  const contratoNums = [...new Set(contratos.map(c => c.contrato).filter(Boolean))];
  const contratosExistentes = new Set<string>();
  if (contratoNums.length) {
    const exc = await query<{ contrato: string }>(`SELECT DISTINCT "contrato" FROM "PEOPLE" WHERE "contrato" = ANY($1)`, [contratoNums]);
    exc.rows.forEach(r => contratosExistentes.add(r.contrato));
  }

  for (const c of contratos) {
    const issues: string[] = [];
    const cursoSet = c.campaign ? (cursoPorCampaign.get(c.campaign) || new Set<string>()) : null;

    if (!c.campaign) issues.push(`❌ campaña no resuelta (CSV: "${c.campaignRaw}")`);
    if (!c.contrato || /x{2,}/i.test(c.contrato)) issues.push(`❌ noContrato inválido/placeholder ("${c.contrato}")`);
    else if (contratosExistentes.has(c.contrato)) issues.push(`❌ noContrato ya existe en PEOPLE: ${c.contrato}`);
    if (!c.titular.primerNombre || !c.titular.primerApellido || !c.titular.numeroId) issues.push('❌ titular incompleto (nombre/apellido/id)');

    const cursos: { who: string; tipoCurso: string | null; horarioCurso: string | null; tipoCursoRaw: string; horarioRaw: string; email: string | null }[] = [];
    if (c.titularEsBeneficiario) cursos.push({ who: 'titular', tipoCurso: c.titular.tipoCurso, horarioCurso: c.titular.horarioCurso, tipoCursoRaw: c.titular.tipoCurso, horarioRaw: c.titular.horarioCurso, email: c.titular.email });
    c.beneficiarios.forEach(b => cursos.push({ who: `benef${b._idx}`, tipoCurso: b.tipoCurso, horarioCurso: b.horarioCurso, tipoCursoRaw: b.tipoCursoRaw, horarioRaw: b.horarioRaw, email: b.email }));
    if (cursos.length === 0) issues.push('❌ sin beneficiarios');
    for (const cu of cursos) {
      if (!cu.tipoCurso) issues.push(`❌ curso no reconocido (${cu.who}): "${cu.tipoCursoRaw}"`);
      else if (!cu.horarioCurso) issues.push(`❌ horario no reconocido (${cu.who}): "${cu.horarioRaw}"`);
      else if (cursoSet && !cursoSet.has(`${cu.tipoCurso}||${cu.horarioCurso}`)) issues.push(`❌ ${cu.tipoCurso} ${cu.horarioCurso} NO existe en ${c.campaign} (${cu.who})`);
      if (cu.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cu.email)) issues.push(`⚠ email inválido (${cu.who}): ${cu.email}`);
      if (!cu.email) issues.push(`⚠ sin email (${cu.who})`);
    }

    const ids = [c.titular.numeroId, ...c.beneficiarios.map(b => b.numeroId)].filter(Boolean) as string[];
    ids.forEach(id => { if (existentes.has(id)) issues.push(`❌ numeroId ya existe en PEOPLE: ${id}`); });
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) issues.push(`❌ numeroId duplicado en el contrato: ${dup}`);

    c._issues = issues;
  }
}

/** Post-proceso: fechaContrato real del CSV + finalContrato = fecha + 12 meses. */
async function fijarFechas(c: ParsedContrato): Promise<boolean> {
  const fecha = parseFecha(c.fechaContratoCSV);
  if (!fecha) return false;
  await query(
    `UPDATE "PEOPLE" SET "fechaContrato"=$2::date, "finalContrato"=($2::date + INTERVAL '12 months')::date, "_updatedDate"=NOW() WHERE "contrato"=$1`,
    [c.contrato, fecha]);
  return true;
}

/** Post-proceso: logins de 2ºs hermanos que comparten email (dedupe por email). */
async function fixHermanosSinLogin(contrato: string): Promise<number> {
  const faltantes = (await query<{ academicaId: string; userLogin: string; numeroId: string; primerNombre: string; primerApellido: string }>(
    `SELECT a."_id" AS "academicaId", a."userLogin", a."numeroId", a."primerNombre", a."primerApellido"
       FROM "ACADEMICA" a
      WHERE a."contrato"=$1 AND a."userLogin" IS NOT NULL AND a."userLogin" <> ''
        AND NOT EXISTS (SELECT 1 FROM "USUARIOS_ROLES" u WHERE u."userLogin" = a."userLogin")`,
    [contrato])).rows;
  let creados = 0;
  for (const f of faltantes) {
    const synthEmail = `${f.userLogin}@est.mosaico.cl`;
    const uid = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await query(
      `INSERT INTO "USUARIOS_ROLES" ("_id","email","userLogin","nombre","apellido","numberid","contrato","password","rol","activo","origen","_createdDate","_updatedDate")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ESTUDIANTE',false,'ADMIN',NOW(),NOW())
       ON CONFLICT DO NOTHING`,
      [uid, synthEmail, f.userLogin, f.primerNombre || '', f.primerApellido || '', f.numeroId || null, contrato, f.numeroId || '1234']);
    await query(`UPDATE "ACADEMICA" SET "email"=$2, "_updatedDate"=NOW() WHERE "_id"=$1`, [f.academicaId, synthEmail]);
    creados++;
  }
  return creados;
}

/** Dry-run: parsea + valida, sin escribir nada. */
export async function validateBulk(csvText: string, opts: ParseOpts): Promise<BulkResumen> {
  const contratos = parseContratosCsv(csvText, opts);
  await validarContratos(contratos);
  const resultados = contratos.map(toResultado);
  return {
    total: resultados.length,
    bloqueantes: resultados.filter(r => r.bloqueante).length,
    observaciones: resultados.reduce((n, r) => n + r.issues.length, 0),
    contratos: resultados,
  };
}

/** Apply: crea los contratos sin errores bloqueantes. */
export async function createBulk(csvText: string, opts: ParseOpts, createdBy?: string): Promise<BulkResumen> {
  const contratos = parseContratosCsv(csvText, opts);
  await validarContratos(contratos);

  let creados = 0, omitidos = 0, fallidos = 0;
  const out: ContratoResultado[] = [];

  for (const c of contratos) {
    const base = toResultado(c);
    if (base.bloqueante) { base.estado = 'omitido'; base.mensaje = 'Errores bloqueantes'; omitidos++; out.push(base); continue; }
    try {
      await validarNumeroIds(c.titular, c.beneficiarios || []);
      const created = await createFullContract({
        contrato: c.contrato,
        titular: c.titular,
        financial: c.financial,
        beneficiarios: c.beneficiarios || [],
        titularEsBeneficiario: c.titularEsBeneficiario === true,
        tipoPlan: normalizeTipoPlan(c.financial?.plan),
        createdBy: createdBy || 'migracion-lote',
        clientToday: null,
      });
      let extra = '';
      try { if (await fijarFechas(c)) extra += ' +fecha'; } catch (e: any) { extra += ` (fecha err: ${e.message})`; }
      try { const h = await fixHermanosSinLogin(c.contrato); if (h) extra += ` +${h} login(s) hermano`; } catch (e: any) { extra += ` (hermano err: ${e.message})`; }
      base.estado = 'creado';
      base.mensaje = `Creado${extra}`;
      base.beneficiariosCreados = created.beneficiarios?.length ?? 0;
      creados++;
    } catch (e: any) {
      base.estado = 'fallido';
      base.mensaje = e?.message || 'Error al crear';
      fallidos++;
    }
    out.push(base);
  }

  return {
    total: out.length,
    bloqueantes: out.filter(r => r.bloqueante).length,
    observaciones: out.reduce((n, r) => n + r.issues.length, 0),
    creados, omitidos, fallidos,
    contratos: out,
  };
}
