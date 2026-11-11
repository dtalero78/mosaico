/**
 * Libro de Producción (Aprobación › Libro de Producción).
 *
 * Una fila por CONTRATO (titular), con sus beneficiarios como sub-filas. Fuente
 * única = la plataforma:
 *   - PEOPLE (titular): datos personales, referencias, Estado Actual (`aprobacion`),
 *     observaciones, escalera comercial del día de la matrícula y casillas
 *     suscripcionPago / prixus.
 *   - FINANCIEROS: plan (cuotas), valor cuota, saldo, total, 1ª cuota (fechaPago).
 *   - PAGOS_TITULARES cuota 0: fecha/forma de pago, inscripción pagada, conciliado
 *     (validado + quién/cuándo), factura/boleta.
 *   - ACADEMICA_BOOKINGS: asistencia a la WELCOME de cada beneficiario.
 * Un contrato cae en la vigencia y semana por PEOPLE.fechaCreacion convertida a la
 * hora LOCAL de su país (ver src/lib/vigencias-comerciales.ts). Entran todos los
 * estados; se excluyen los contratos de prueba (PRB-). Una consulta por tabla.
 */

import 'server-only';
import { query, queryMany, queryOne, transaction } from '@/lib/postgres';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { ids } from '@/lib/id-generator';
import { armarVigenciasAnio, semanaDe, type Vigencia } from '@/lib/vigencias-comerciales';
import { resolverEscalera } from '@/lib/crm';
import { registrarEventoContrato, diffCampos } from '@/lib/contrato-eventos';

/** Expresión SQL de la zona horaria del país del contrato (alias p). Igual a zonaHorariaPais(). */
const TZ_SQL = `CASE WHEN p."plataforma" ILIKE 'chile%' THEN 'America/Santiago'
                     WHEN p."plataforma" ILIKE 'ecuador%' THEN 'America/Guayaquil'
                     WHEN p."plataforma" ILIKE 'per%' THEN 'America/Lima'
                     ELSE 'America/Bogota' END`;

const fmtLocal = (d: any): string | null => {
  if (!d) return null;
  if (d instanceof Date) {
    // pg devuelve TIMESTAMP (sin zona) como Date en hora local del proceso: se reconstruye tal cual.
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  return String(d).replace(' ', 'T').slice(0, 16);
};
const iso = (d: any): string | null => (d ? new Date(d).toISOString() : null);

/**
 * Estado del contrato en el libro = "Estado Actual" de la ficha (PEOPLE.aprobacion) cuando
 * tiene un valor real; sin estado (vacío o "Pendiente") se distingue si ya firmó:
 * firmado → "Pendiente aprobación", sin firma → "Sin firmar" (término del Centro de Aprobaciones).
 */
function estadoLibro(aprobacion: string | null, firmado: boolean): string {
  const a = String(aprobacion || '').trim();
  if (a && a.toLowerCase() !== 'pendiente') return a;
  return firmado ? 'Pendiente aprobación' : 'Sin firmar';
}
const num = (v: any): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const nombre = (r: any) => [r.primerNombre, r.segundoNombre, r.primerApellido, r.segundoApellido]
  .map((s) => String(s || '').trim()).filter(Boolean).join(' ');

export interface BeneficiarioLibro {
  id: string; nombre: string; documento: string; telefono: string; correo: string;
  curso: string; welcome: 'SI' | 'NO' | 'NA' | '—'; aprobacion: string | null;
}
export interface RegistroLibro {
  titularId: string; contrato: string; item: number; semana: number | null;
  creadoLocal: string | null; fechaIngreso: string | null; fechaPago: string | null;
  formaPago: string; conciliado: { si: boolean; por: string | null; fecha: string | null };
  plan: number | null; tipoPlan: string | null; tipoPlanId: string | null; inscripcionPagada: number | null; valorCuota: number | null;
  saldo: number | null; totalPlan: number | null; fechaPrimeraCuota: string | null;
  suscripcionPago: boolean; prixus: boolean; factura: string | null; listo: boolean;
  /** Estado mostrado: el "Estado Actual" de la ficha, o "Pendiente aprobación" / "Sin firmar" si aún no tiene estado. */
  aprobacion: string; aprobacionFicha: string | null; firmado: boolean;
  /** Lo que falta de la carpeta del contrato: documentos anexos, recibo de inscripción, PDF en Drive. */
  faltantes: ('DOCUMENTOS' | 'RECIBO' | 'DRIVE')[];
  estado: string | null; modulo: boolean; extemporanea: boolean; migrado: boolean; observaciones: string | null; pais: string | null;
  titular: { nombre: string; documento: string; telefono: string; correo: string; direccion: string; ciudad: string };
  referencias: { nombre: string; telefono: string; parentesco: string }[];
  comercial: {
    ejecutivo: string; fullExecutive: string; jefeGrupo: string; gerente: string;
    gerenteDivision: string; salesManager: string; filial: string; origenMatricula: string;
  };
  beneficiarios: BeneficiarioLibro[];
}

// ── Vigencias ────────────────────────────────────────────────────────────────

const mapVig = (r: any): Vigencia => ({ _id: r._id, anio: r.anio, mes: r.mes, inicio: fmtLocal(r.inicio)!, fin: fmtLocal(r.fin)! });

export async function listarVigencias(): Promise<Vigencia[]> {
  const rows = await queryMany<any>(
    `SELECT "_id","anio","mes",to_char("inicio",'YYYY-MM-DD"T"HH24:MI') inicio,to_char("fin",'YYYY-MM-DD"T"HH24:MI') fin
       FROM "VIGENCIAS_COMERCIALES" ORDER BY "anio" DESC, "mes" DESC`);
  return rows.map(mapVig);
}

/** Vigencia que contiene "ahora" (hora de Bogotá como referencia); si no hay, la más reciente. */
export async function vigenciaActual(vigencias?: Vigencia[]): Promise<Vigencia | null> {
  const lista = vigencias ?? await listarVigencias();
  if (!lista.length) return null;
  const ahora = await queryOne<{ t: string }>(`SELECT to_char(NOW() AT TIME ZONE 'America/Bogota','YYYY-MM-DD"T"HH24:MI') t`);
  const t = ahora?.t || '';
  return lista.find((v) => v.inicio <= t && t < v.fin) ?? lista[0];
}

/** Crea o reemplaza las 12 vigencias de un año (transacción). */
export async function generarVigenciasAnio(anio: number, inicioEnero: string, fines: string[], hora: string, actor: string) {
  if (!Number.isInteger(anio) || anio < 2020 || anio > 2100) throw new ValidationError('Año inválido.');
  const r = armarVigenciasAnio(anio, inicioEnero, fines, hora);
  if (!r.ok) throw new ValidationError(r.error);
  // Continuidad con los años vecinos ya cargados (sin huecos ni solapes).
  const dic = await queryOne<{ fin: string }>(
    `SELECT to_char("fin",'YYYY-MM-DD"T"HH24:MI') fin FROM "VIGENCIAS_COMERCIALES" WHERE "anio"=$1 AND "mes"=12`, [anio - 1]);
  if (dic && dic.fin !== r.vigencias[0].inicio) {
    throw new ValidationError(`Diciembre ${anio - 1} termina el ${dic.fin.replace('T', ' ')}; enero ${anio} debe empezar ahí mismo.`);
  }
  const ene = await queryOne<{ inicio: string }>(
    `SELECT to_char("inicio",'YYYY-MM-DD"T"HH24:MI') inicio FROM "VIGENCIAS_COMERCIALES" WHERE "anio"=$1 AND "mes"=1`, [anio + 1]);
  if (ene && ene.inicio !== r.vigencias[11].fin) {
    throw new ValidationError(`Enero ${anio + 1} empieza el ${ene.inicio.replace('T', ' ')}; diciembre ${anio} debe terminar ahí mismo.`);
  }
  await transaction(async (client) => {
    for (const v of r.vigencias) {
      await client.query(
        `INSERT INTO "VIGENCIAS_COMERCIALES" ("_id","anio","mes","inicio","fin","creadoPor")
         VALUES ($1,$2,$3,$4::timestamp,$5::timestamp,$6)
         ON CONFLICT ("anio","mes") DO UPDATE SET "inicio"=EXCLUDED."inicio","fin"=EXCLUDED."fin",
           "creadoPor"=EXCLUDED."creadoPor","_updatedDate"=NOW()`,
        [ids.libro(), v.anio, v.mes, v.inicio, v.fin, actor]);
    }
  });
  return r.vigencias;
}

// ── Libro ────────────────────────────────────────────────────────────────────

async function construir(
  filtro: { vigencia: Vigencia } | { titularId: string },
): Promise<RegistroLibro[]> {
  const porVig = 'vigencia' in filtro;
  const params: any[] = porVig ? [filtro.vigencia.inicio, filtro.vigencia.fin] : [filtro.titularId];
  const where = porVig
    ? `p."fechaCreacion" >= ($1::timestamp AT TIME ZONE 'UTC') - INTERVAL '1 day'
       AND p."fechaCreacion" <  ($2::timestamp AT TIME ZONE 'UTC') + INTERVAL '1 day'`
    : `p."contrato" = (SELECT "contrato" FROM "PEOPLE" WHERE "_id" = $1)`;

  const titulares = await queryMany<any>(
    `SELECT * FROM (
       SELECT DISTINCT ON (p."contrato")
              p."_id", p."contrato", p."numeroId", p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido",
              p."celular", p."telefono", p."email", p."domicilio", p."ciudad", p."plataforma", p."aprobacion", p."estado",
              p."observacionesContrato", p."referenciaUno", p."telefonoRefUno", p."parentezcoRefUno",
              p."referenciaDos", p."telefonoRefDos", p."parentezcoRefDos", p."asesor", p."asesorMail", p."liderComercial",
              p."fullExecutive", p."jefeGrupo", p."gerente", p."gerenteDivision", p."salesManager", p."filial",
              p."gestionContratoListo", p."altaMigracion", p."origenMatricula", p."suscripcionPago", p."prixus", p."tipoPlanId", p."modulo", p."extemporanea",
              (COALESCE(p."hashConsentimiento",'') <> '') AS firmado,
              (CASE WHEN jsonb_typeof(p."documentacion") = 'array' THEN jsonb_array_length(p."documentacion") ELSE 0 END) > 0 AS con_docs,
              (p."reciboInscripcion" IS NOT NULL) AS con_recibo,
              (p."driveArchivadoEn" IS NOT NULL) AS con_drive,
              to_char(p."fechaCreacion" AT TIME ZONE (${TZ_SQL}), 'YYYY-MM-DD"T"HH24:MI') AS creado_local
         FROM "PEOPLE" p
        WHERE p."tipoUsuario" = 'TITULAR' AND COALESCE(p."contrato",'') <> '' AND p."contrato" NOT LIKE 'PRB-%'
          AND ${where}
        ORDER BY p."contrato", (COALESCE(p."hashConsentimiento",'') <> '') DESC, (p."aprobacion" IS NOT NULL) DESC, p."_createdDate" ASC
     ) t ${porVig ? `WHERE t.creado_local >= to_char($1::timestamp,'YYYY-MM-DD"T"HH24:MI')
                     AND t.creado_local <  to_char($2::timestamp,'YYYY-MM-DD"T"HH24:MI')` : ''}
     ORDER BY t.creado_local, t."contrato"`, params);
  if (!titulares.length) return [];

  const contratos = titulares.map((t) => t.contrato);
  const [fins, pagos, benefs] = await Promise.all([
    queryMany<any>(
      `SELECT DISTINCT ON ("contrato") "contrato","totalPlan","valorCuota","pagoInscripcion","numeroCuotas","saldo","fechaPago","plan"
         FROM "FINANCIEROS" WHERE "contrato" = ANY($1) ORDER BY "contrato", "_updatedDate" DESC NULLS LAST`, [contratos]),
    queryMany<any>(
      `SELECT DISTINCT ON (p."contrato") p."contrato", pt."fechaPago", pt."medioPago", pt."numeroReferencia",
              pt."valorPagado", pt."numeroFactura", pt."validado", pt."validadoPor", pt."fechaValidacion"
         FROM "PAGOS_TITULARES" pt JOIN "PEOPLE" p ON p."_id" = pt."idPeople"
        WHERE p."contrato" = ANY($1) AND pt."numCuota" = 0
        ORDER BY p."contrato", pt."validado" DESC NULLS LAST, pt."fechaPago" ASC NULLS LAST`, [contratos]),
    queryMany<any>(
      `SELECT "_id","contrato","numeroId","primerNombre","segundoNombre","primerApellido","segundoApellido",
              "celular","email","tipoCurso","aprobacion"
         FROM "PEOPLE" WHERE "contrato" = ANY($1) AND "tipoUsuario" = 'BENEFICIARIO'
        ORDER BY "contrato", "_createdDate"`, [contratos]),
  ]);

  const tipoIds = Array.from(new Set(titulares.map((t) => t.tipoPlanId).filter(Boolean)));
  const tipos = tipoIds.length
    ? await queryMany<any>(`SELECT "_id","nombre" FROM "PLANES_TIPOS" WHERE "_id" = ANY($1)`, [tipoIds]) : [];
  const tipoPor = new Map(tipos.map((x) => [x._id, x.nombre]));

  const benefIds = benefs.map((b) => b._id);
  const welcome = benefIds.length ? await queryMany<any>(
    `SELECT b."_id", bool_or(COALESCE(bk."asistio", false) OR COALESCE(bk."asistencia", false)) AS asistio
       FROM "PEOPLE" b
       JOIN "ACADEMICA" a ON a."numeroId" = b."numeroId"
       JOIN "ACADEMICA_BOOKINGS" bk ON (bk."studentId" = a."_id" OR bk."idEstudiante" = a."_id")
       LEFT JOIN "CALENDARIO" c ON c."_id" = COALESCE(bk."eventoId", bk."idEvento")
      WHERE b."_id" = ANY($1) AND bk."cancelo" IS NOT TRUE
        AND (UPPER(COALESCE(c."tipo", bk."tipoEvento", '')) = 'WELCOME' OR UPPER(COALESCE(c."curso", '')) = 'WELCOME'
             OR UPPER(COALESCE(c."nivel", bk."nivel", '')) = 'WELCOME' OR UPPER(COALESCE(c."tituloONivel", '')) LIKE 'WELCOME%')
      GROUP BY b."_id"`, [benefIds]) : [];

  // Escalera: la guardada en el titular manda; si falta, la actual del asesor en el CRM
  // (una consulta por asesor distinto, cacheada).
  const asesoresSinEscalera = new Map<string, { correo: string; nombre: string }>();
  for (const t of titulares) {
    if ((t.fullExecutive || t.jefeGrupo || t.gerente || t.gerenteDivision || t.salesManager) && t.filial) continue;
    const k = String(t.asesorMail || t.asesor || '').trim().toLowerCase();
    if (k && !asesoresSinEscalera.has(k)) asesoresSinEscalera.set(k, { correo: t.asesorMail || '', nombre: t.asesor || '' });
  }
  const escaleras = new Map<string, any>();
  await Promise.all(Array.from(asesoresSinEscalera.entries()).map(async ([k, a]) => {
    try { escaleras.set(k, await resolverEscalera(a.correo, a.nombre)); } catch { /* best-effort */ }
  }));

  const finPor = new Map(fins.map((f) => [f.contrato, f]));
  const pagoPor = new Map(pagos.map((p) => [p.contrato, p]));
  const welPor = new Map(welcome.map((w) => [w._id, w.asistio === true]));
  const benefPor = new Map<string, any[]>();
  for (const b of benefs) { if (!benefPor.has(b.contrato)) benefPor.set(b.contrato, []); benefPor.get(b.contrato)!.push(b); }

  return titulares.map((t, i) => {
    const f = finPor.get(t.contrato) || {};
    const pg = pagoPor.get(t.contrato) || {};
    const forma = [pg.medioPago, pg.numeroReferencia].map((s: any) => String(s || '').trim()).filter(Boolean).join(' · ');
    const contado = /contado/i.test(String(f.plan || ''));
    const esc = escaleras.get(String(t.asesorMail || t.asesor || '').trim().toLowerCase()) || {};
    return {
      titularId: t._id,
      contrato: t.contrato,
      item: i + 1,
      semana: porVig ? semanaDe((filtro as any).vigencia, t.creado_local) : null,
      creadoLocal: t.creado_local,
      fechaIngreso: t.creado_local ? t.creado_local.slice(0, 10) : null,
      fechaPago: pg.fechaPago ? iso(pg.fechaPago)!.slice(0, 10) : null,
      formaPago: forma,
      conciliado: { si: pg.validado === true, por: pg.validadoPor || null, fecha: pg.fechaValidacion ? iso(pg.fechaValidacion)!.slice(0, 10) : null },
      plan: contado ? 1 : num(f.numeroCuotas),
      // Tipo del catálogo PLANES_TIPOS si el contrato lo tiene; si no, Crédito/Contado de FINANCIEROS.
      tipoPlan: (t.tipoPlanId && tipoPor.get(t.tipoPlanId)) || f.plan || null,
      tipoPlanId: t.tipoPlanId || null,
      inscripcionPagada: num(pg.valorPagado),
      valorCuota: num(f.valorCuota),
      saldo: num(f.saldo),
      totalPlan: num(f.totalPlan),
      fechaPrimeraCuota: f.fechaPago ? iso(f.fechaPago)!.slice(0, 10) : null,
      suscripcionPago: t.suscripcionPago === true,
      prixus: t.prixus === true,
      factura: pg.numeroFactura || null,
      listo: t.gestionContratoListo === true,
      aprobacion: estadoLibro(t.aprobacion, t.firmado === true),
      aprobacionFicha: t.aprobacion || null,
      firmado: t.firmado === true,
      faltantes: [
        ...(t.con_docs === true ? [] : ['DOCUMENTOS' as const]),
        ...(t.con_recibo === true ? [] : ['RECIBO' as const]),
        ...(t.con_drive === true ? [] : ['DRIVE' as const]),
      ],
      estado: t.estado || null, modulo: t.modulo === true, extemporanea: t.extemporanea === true, migrado: t.altaMigracion === true,
      observaciones: t.observacionesContrato || null,
      pais: t.plataforma || null,
      titular: {
        nombre: nombre(t), documento: t.numeroId || '', telefono: t.celular || t.telefono || '',
        correo: t.email || '', direccion: t.domicilio || '', ciudad: t.ciudad || '',
      },
      referencias: [
        { nombre: t.referenciaUno || '', telefono: t.telefonoRefUno || '', parentesco: t.parentezcoRefUno || '' },
        { nombre: t.referenciaDos || '', telefono: t.telefonoRefDos || '', parentesco: t.parentezcoRefDos || '' },
      ],
      comercial: {
        ejecutivo: String(t.asesor || '').replace(/\s+/g, ' ').trim(),
        fullExecutive: t.fullExecutive || esc.fullExecutive || '', jefeGrupo: t.jefeGrupo || esc.jefeGrupo || '',
        gerente: t.gerente || esc.gerente || '', gerenteDivision: t.gerenteDivision || esc.gerenteDivision || '',
        salesManager: t.salesManager || esc.salesManager || '', filial: t.filial || esc.filial || '',
        origenMatricula: t.origenMatricula || '',
      },
      beneficiarios: (benefPor.get(t.contrato) || []).map((b) => ({
        id: b._id, nombre: nombre(b), documento: b.numeroId || '', telefono: b.celular || '', correo: b.email || '',
        curso: b.tipoCurso || '—',
        welcome: welPor.has(b._id) ? (welPor.get(b._id) ? 'SI' : 'NO') : '—',
        aprobacion: b.aprobacion || null,
      })),
    } as RegistroLibro;
  });
}

export async function libroDeVigencia(vigenciaId?: string | null) {
  const vigencias = await listarVigencias();
  const vigencia = vigenciaId ? vigencias.find((v) => v._id === vigenciaId) : await vigenciaActual(vigencias);
  if (vigenciaId && !vigencia) throw new NotFoundError('Vigencia', vigenciaId);
  const registros = vigencia ? await construir({ vigencia }) : [];
  return { vigencias, vigencia: vigencia || null, registros, sinVigencia: await contarSinVigencia() };
}

/**
 * Titulares creados dentro del rango de vigencias configurado (a partir del inicio de la primera)
 * que NO caen en ninguna: no salen en el libro de ningún mes. Sirve para avisar que falta generar
 * el calendario del año siguiente.
 */
async function contarSinVigencia(): Promise<number> {
  const r = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM "PEOPLE" p
      WHERE p."tipoUsuario" = 'TITULAR' AND COALESCE(p."contrato",'') <> '' AND p."contrato" NOT LIKE 'PRB-%'
        AND p."fechaCreacion" >= (SELECT MIN("inicio") FROM "VIGENCIAS_COMERCIALES") AT TIME ZONE 'UTC' - INTERVAL '1 day'
        AND NOT EXISTS (
          SELECT 1 FROM "VIGENCIAS_COMERCIALES" v
           WHERE to_char(p."fechaCreacion" AT TIME ZONE (${TZ_SQL}), 'YYYY-MM-DD"T"HH24:MI') >= to_char(v."inicio",'YYYY-MM-DD"T"HH24:MI')
             AND to_char(p."fechaCreacion" AT TIME ZONE (${TZ_SQL}), 'YYYY-MM-DD"T"HH24:MI') <  to_char(v."fin",'YYYY-MM-DD"T"HH24:MI'))`);
  return r?.n || 0;
}

// ── Gestión Comercial (pestaña "Gestión" del libro) ───────────────────────────

/** Grupo de estado para los conteos de Gestión Comercial. */
export type GrupoGestion = 'aprobada' | 'rechazada' | 'devuelta' | 'firmadaSinAprobar' | 'pendiente';
function grupoGestion(aprobacion: string | null, firmado: boolean): GrupoGestion {
  const a = String(aprobacion || '').trim().toLowerCase();
  if (a.startsWith('aprobad') || a.startsWith('finaliz')) return 'aprobada';
  if (a.startsWith('rechaz')) return 'rechazada';
  if (a.startsWith('devuel')) return 'devuelta';
  if ((!a || a === 'pendiente') && firmado) return 'firmadaSinAprobar';
  return 'pendiente'; // sin firmar, contrato nulo, retractado u otro estado
}

export interface FilaGestion {
  anio: number; mes: number; semana: number | null; pais: string; filial: string; grupo: GrupoGestion;
  estado: string;
  escala: { ejTraining: string; fullExecutive: string; jefeGrupo: string; gerente: string; gerenteDivision: string; salesManager: string };
  /** N° de contrato y _id del titular (lista de matrículas al pulsar un número). */
  contrato: string; titularId: string;
  /** Nombre del titular: solo si quien consulta tiene APROBACION.LIBRO_PRODUCCION.VER. */
  titular?: string;
}

/**
 * Contratos de un año comercial (o de un mes) con lo mínimo para Gestión Comercial:
 * mes y semana de su vigencia, país, filial, grupo de estado y escala. Una sola consulta
 * (solo titulares; sin finanzas ni beneficiarios). Mismas reglas de vigencia que el libro.
 */
export async function gestionComercial(anio: number, mes: number | null, opts: { conTitular?: boolean } = {}) {
  const todas = await listarVigencias();
  const anios = Array.from(new Set(todas.map((v) => v.anio))).sort((a, b) => b - a);
  const vigs = todas.filter((v) => v.anio === anio && (!mes || v.mes === mes)).sort((a, b) => a.mes - b.mes);
  if (!vigs.length) return { anios, vigencias: [] as Vigencia[], filas: [] as FilaGestion[] };
  const desde = vigs[0].inicio, hasta = vigs[vigs.length - 1].fin;

  const rows = await queryMany<any>(
    `SELECT * FROM (
       SELECT DISTINCT ON (p."contrato") p."_id" AS titular_id, p."contrato", p."plataforma", p."aprobacion", p."filial",
              CONCAT_WS(' ', NULLIF(TRIM(p."primerNombre"),''), NULLIF(TRIM(p."segundoNombre"),''), NULLIF(TRIM(p."primerApellido"),''), NULLIF(TRIM(p."segundoApellido"),'')) AS titular_nombre,
              p."asesor", p."fullExecutive", p."jefeGrupo", p."gerente", p."gerenteDivision", p."salesManager",
              (COALESCE(p."hashConsentimiento",'') <> '') AS firmado,
              to_char(p."fechaCreacion" AT TIME ZONE (${TZ_SQL}), 'YYYY-MM-DD"T"HH24:MI') AS creado_local
         FROM "PEOPLE" p
        WHERE p."tipoUsuario" = 'TITULAR' AND COALESCE(p."contrato",'') <> '' AND p."contrato" NOT LIKE 'PRB-%'
          AND p."fechaCreacion" >= ($1::timestamp AT TIME ZONE 'UTC') - INTERVAL '1 day'
          AND p."fechaCreacion" <  ($2::timestamp AT TIME ZONE 'UTC') + INTERVAL '1 day'
        ORDER BY p."contrato", (COALESCE(p."hashConsentimiento",'') <> '') DESC, (p."aprobacion" IS NOT NULL) DESC, p."_createdDate" ASC
     ) t
     WHERE t.creado_local >= to_char($1::timestamp,'YYYY-MM-DD"T"HH24:MI') AND t.creado_local < to_char($2::timestamp,'YYYY-MM-DD"T"HH24:MI')`,
    [desde, hasta]);

  const limpio = (s: any) => String(s || '').replace(/\s+/g, ' ').trim();
  const filas: FilaGestion[] = [];
  for (const t of rows) {
    const v = vigs.find((x) => x.inicio <= t.creado_local && t.creado_local < x.fin);
    if (!v) continue;
    filas.push({
      anio: v.anio, mes: v.mes, semana: semanaDe(v, t.creado_local),
      pais: limpio(t.plataforma) || 'Sin país', filial: limpio(t.filial) || 'Sin filial',
      grupo: grupoGestion(t.aprobacion, t.firmado === true),
      estado: estadoLibro(t.aprobacion, t.firmado === true),
      escala: {
        ejTraining: limpio(t.asesor), fullExecutive: limpio(t.fullExecutive),
        jefeGrupo: limpio(t.jefeGrupo), gerente: limpio(t.gerente), gerenteDivision: limpio(t.gerenteDivision),
        salesManager: limpio(t.salesManager),
      },
      contrato: t.contrato, titularId: t.titular_id,
      ...(opts.conTitular ? { titular: limpio(t.titular_nombre) } : {}),
    });
  }
  return { anios, vigencias: vigs, filas };
}

/** Un contrato del libro (vista detallada), ubicado en su vigencia/semana si existe. */
export async function registroLibro(titularId: string) {
  const [r] = await construir({ titularId });
  if (!r) throw new NotFoundError('Contrato', titularId);
  const vigencias = await listarVigencias();
  const vigencia = r.creadoLocal ? vigencias.find((v) => v.inicio <= r.creadoLocal! && r.creadoLocal! < v.fin) || null : null;
  if (vigencia) r.semana = semanaDe(vigencia, r.creadoLocal!);
  return { registro: r, vigencia };
}

/** Casillas manuales del titular (Suscripción de pago / Prixus). */
export async function actualizarCasillas(titularId: string, cambios: { suscripcionPago?: boolean; prixus?: boolean }, actor: string) {
  const sets: string[] = []; const vals: any[] = [];
  if (typeof cambios.suscripcionPago === 'boolean') { vals.push(cambios.suscripcionPago); sets.push(`"suscripcionPago" = $${vals.length}`); }
  if (typeof cambios.prixus === 'boolean') { vals.push(cambios.prixus); sets.push(`"prixus" = $${vals.length}`); }
  if (!sets.length) throw new ValidationError('Nada que actualizar (suscripcionPago / prixus).');
  vals.push(titularId);
  const res = await query(
    `UPDATE "PEOPLE" SET ${sets.join(', ')}, "_updatedDate" = NOW()
      WHERE "_id" = $${vals.length} AND "tipoUsuario" = 'TITULAR' RETURNING "suscripcionPago","prixus"`, vals);
  if (!res.rowCount) throw new NotFoundError('Titular', titularId);
  console.log(`[libro-produccion] casillas ${titularId} ${JSON.stringify(cambios)} por ${actor}`);
  return res.rows[0];
}

// ── Catálogo de planes y tipos (por país) ─────────────────────────────────────

export const PAISES_PLAN = ['Chile', 'Colombia', 'Ecuador', 'Perú'] as const;

export interface TipoPlan {
  _id: string; pais: string; cuotas: number; nombre: string;
  inscripcion: number | null; valorCuota: number | null; total: number | null;
  descripcion: string | null; activo: boolean; contratos: number;
}

export async function listarPlanes(pais?: string | null): Promise<TipoPlan[]> {
  const rows = await queryMany<any>(
    `SELECT t.*, (SELECT COUNT(*)::int FROM "PEOPLE" p WHERE p."tipoPlanId" = t."_id" AND p."tipoUsuario" = 'TITULAR') AS contratos
       FROM "PLANES_TIPOS" t ${pais ? `WHERE t."pais" = $1` : ''}
      ORDER BY t."pais", t."cuotas", t."nombre"`, pais ? [pais] : []);
  return rows.map((r) => ({
    _id: r._id, pais: r.pais, cuotas: r.cuotas, nombre: r.nombre,
    inscripcion: num(r.inscripcion), valorCuota: num(r.valorCuota), total: num(r.total),
    descripcion: r.descripcion || null, activo: r.activo !== false, contratos: r.contratos || 0,
  }));
}

/** Crea (sin id) o actualiza (con id) un tipo de plan. Montos opcionales; nombre único por país+plan. */
export async function guardarTipoPlan(datos: any, actor: string, id?: string) {
  const pais = String(datos?.pais || '').trim();
  const cuotas = Number(datos?.cuotas);
  const nombreTipo = String(datos?.nombre || '').trim();
  if (!PAISES_PLAN.includes(pais as any)) throw new ValidationError(`País inválido (${PAISES_PLAN.join(', ')}).`);
  if (!Number.isInteger(cuotas) || cuotas < 1 || cuotas > 60) throw new ValidationError('El plan (número de cuotas) debe ser un entero entre 1 y 60.');
  if (!nombreTipo) throw new ValidationError('El nombre del tipo de plan es obligatorio.');
  const monto = (v: any) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new ValidationError('Los montos deben ser números positivos.');
    return n;
  };
  const vals = [pais, cuotas, nombreTipo, monto(datos?.inscripcion), monto(datos?.valorCuota), monto(datos?.total),
    String(datos?.descripcion || '').trim() || null, datos?.activo !== false];
  const dup = await queryOne<{ _id: string }>(
    `SELECT "_id" FROM "PLANES_TIPOS" WHERE "pais" = $1 AND "cuotas" = $2 AND LOWER("nombre") = LOWER($3) AND "_id" <> $4`,
    [pais, cuotas, nombreTipo, id || '']);
  if (dup) throw new ValidationError(`Ya existe el tipo "${nombreTipo}" para el plan ${cuotas} en ${pais}.`);
  if (id) {
    const r = await query(
      `UPDATE "PLANES_TIPOS" SET "pais"=$1,"cuotas"=$2,"nombre"=$3,"inscripcion"=$4,"valorCuota"=$5,"total"=$6,
              "descripcion"=$7,"activo"=$8,"_updatedDate"=NOW() WHERE "_id"=$9 RETURNING "_id"`, [...vals, id]);
    if (!r.rowCount) throw new NotFoundError('Tipo de plan', id);
    return id;
  }
  const nuevo = ids.libro();
  await query(
    `INSERT INTO "PLANES_TIPOS" ("_id","pais","cuotas","nombre","inscripcion","valorCuota","total","descripcion","activo","creadoPor")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [nuevo, ...vals, actor]);
  return nuevo;
}

// ── Ajuste de la escala comercial (botón "Ajuste Escala" del detalle) ───────────────

/**
 * Campos editables: la escalera comercial del contrato. El "Ej. Training" NO se edita
 * aquí: en MOSAICO es PEOPLE.asesor, que además decide el alcance comercial del contrato
 * (quién lo ve en Gestión Contrato) y sale en el PDF; se cambia desde el contrato.
 */
export const CAMPOS_ESCALERA = {
  fullExecutive: { l: 'Full Executive', max: 150 },
  jefeGrupo: { l: 'Jefe de grupo', max: 150 },
  gerente: { l: 'Gerente', max: 150 },
  gerenteDivision: { l: 'Gerente división', max: 150 },
  salesManager: { l: 'Sales Manager', max: 150 },
  filial: { l: 'Filial', max: 150 },
  origenMatricula: { l: 'Origen matrícula', max: 200 },
} as const;
type CampoEscalera = keyof typeof CAMPOS_ESCALERA;

/** Valores actuales + sugerencias (los ya usados en titulares del mismo país) + filiales del catálogo. */
export async function opcionesEscalera(titularId: string) {
  const cols = Object.keys(CAMPOS_ESCALERA).map(c => `"${c}"`).join(',');
  const t = await queryOne<any>(`SELECT "plataforma", ${cols} FROM "PEOPLE" WHERE "_id" = $1 AND "tipoUsuario" = 'TITULAR'`, [titularId]);
  if (!t) throw new NotFoundError('Titular', titularId);
  const campos = Object.keys(CAMPOS_ESCALERA).filter(c => c !== 'filial');
  const usados = await queryMany<{ campo: string; valor: string }>(
    `SELECT DISTINCT x.campo, x.valor FROM "PEOPLE" p,
            LATERAL (VALUES ${campos.map(c => `('${c}', TRIM(p."${c}"))`).join(',')}) AS x(campo, valor)
      WHERE p."tipoUsuario" = 'TITULAR' AND p."plataforma" = $1 AND COALESCE(x.valor, '') <> ''
        AND p."_createdDate" > NOW() - INTERVAL '12 months'
      ORDER BY 1, 2`, [t.plataforma]);
  let filiales = (await queryMany<{ nombre: string }>(
    `SELECT "nombre" FROM "FILIALES" WHERE "activo" = true AND LOWER(TRIM("plataforma")) = LOWER(TRIM($1)) ORDER BY 1`,
    [t.plataforma || ''])).map(f => f.nombre);
  // Si el catálogo de filiales aún no está cargado, se ofrecen las ya usadas en contratos del país.
  if (!filiales.length) {
    filiales = (await queryMany<{ nombre: string }>(
      `SELECT DISTINCT TRIM("filial") AS nombre FROM "PEOPLE" WHERE "tipoUsuario" = 'TITULAR' AND "plataforma" = $1 AND COALESCE(TRIM("filial"), '') <> '' ORDER BY 1`,
      [t.plataforma || ''])).map(f => f.nombre);
  }
  const sugerencias: Record<string, string[]> = {};
  for (const u of usados) (sugerencias[u.campo] ||= []).push(u.valor);
  const actual = Object.fromEntries(Object.keys(CAMPOS_ESCALERA).map(c => [c, t[c] ?? '']));
  return { pais: t.plataforma, actual, sugerencias, filiales };
}

/** Guarda la escalera del titular; motivo obligatorio; queda en el Seguimiento con antes/después. */
export async function actualizarEscalera(titularId: string, datos: Record<string, any>, motivo: string, session: any) {
  const m = String(motivo || '').trim();
  if (m.length < 10) throw new ValidationError('Indica el motivo del ajuste (mínimo 10 caracteres).');
  const cols0 = Object.keys(CAMPOS_ESCALERA).map(c => `"${c}"`).join(',');
  const antes = await queryOne<any>(`SELECT "plataforma", ${cols0} FROM "PEOPLE" WHERE "_id" = $1 AND "tipoUsuario" = 'TITULAR'`, [titularId]);
  if (!antes) throw new NotFoundError('Titular', titularId);

  const nuevos: Partial<Record<CampoEscalera, string | null>> = {};
  for (const [c, def] of Object.entries(CAMPOS_ESCALERA) as [CampoEscalera, { l: string; max: number }][]) {
    if (datos?.[c] === undefined) continue;
    nuevos[c] = String(datos[c] ?? '').replace(/\s+/g, ' ').trim().slice(0, def.max) || null;
  }
  if (nuevos.filial) {
    // Con catálogo cargado para el país, la filial debe ser una del catálogo; sin catálogo se acepta el valor.
    const cat = await queryMany<{ nombre: string }>(
      `SELECT "nombre" FROM "FILIALES" WHERE "activo" = true AND LOWER(TRIM("plataforma")) = LOWER(TRIM($1))`, [antes.plataforma || '']);
    if (cat.length) {
      const f = cat.find(x => x.nombre.trim().toLowerCase() === String(nuevos.filial).toLowerCase());
      if (!f) throw new ValidationError(`La filial "${nuevos.filial}" no pertenece a ${antes.plataforma}.`);
      nuevos.filial = f.nombre;
    }
  }
  const cambios = diffCampos(antes, nuevos);
  if (!Object.keys(cambios).length) throw new ValidationError('No hay cambios en la escala.');

  const cols = Object.keys(cambios);
  await query(
    `UPDATE "PEOPLE" SET ${cols.map((c, i) => `"${c}" = $${i + 2}`).join(', ')}, "_updatedDate" = NOW() WHERE "_id" = $1`,
    [titularId, ...cols.map(c => (nuevos as any)[c])]);
  await registrarEventoContrato({
    personaId: titularId, categoria: 'MATRICULA', accion: 'Ajuste de escala comercial',
    detalle: `${cols.map(c => CAMPOS_ESCALERA[c as CampoEscalera].l).join(', ')} · ${m}`, datos: { cambios }, session,
  });
  return { comercial: Object.fromEntries(Object.keys(CAMPOS_ESCALERA).map(c => [c, c in nuevos ? (nuevos as any)[c] : antes[c]])) };
}

/**
 * "Leer correo" del Ajuste Escala: la IA saca la "Escala de matrícula" del correo de la
 * matrícula (texto pegado o captura). Sólo PROPONE: el formulario se llena, la persona revisa
 * y guarda con actualizarEscalera. El Sales Manager ya registrado no se propone cambiar
 * (manda el del CRM).
 */
const PROMPT_ESCALERA = `Eres un extractor de datos de correos de matrícula de una academia.
Del correo adjunto (texto o imagen) extrae la "escala de matrícula" y el número de contrato.
Devuelve SOLO este JSON:
{
  "contrato": string|null,              // número de matrícula/contrato, p. ej. "01-M5-2341-26"
  "fullExecutive": string|null,         // "Ejecutivo Full" / "Full Executive"
  "jefeGrupo": string|null,             // "Jefe de Grupo" / "Team Manager"
  "gerente": string|null,               // "Gerente"
  "gerenteDivision": string|null,       // "Gerente Div" / "Gerente División"
  "salesManager": string|null,          // "Sales" / "Sales Manager"
  "filial": string|null,                // "Filial"
  "origenMatricula": string|null        // "Origen" / "Origen matrícula" / campaña
}
Reglas: copia los nombres tal como aparecen (sin títulos como "Don"), null si un campo no aparece,
NUNCA inventes. Ignora "Internacional" y la firma de quien envía el correo.`;

const normContrato = (s: any) => String(s ?? '').replace(/\s+/g, '').toUpperCase();

export async function leerEscaleraCorreo(titularId: string, entrada: { texto?: string; imagen?: string }) {
  const t = await queryOne<any>(`SELECT "contrato", "salesManager" FROM "PEOPLE" WHERE "_id" = $1 AND "tipoUsuario" = 'TITULAR'`, [titularId]);
  if (!t) throw new NotFoundError('Titular', titularId);
  const texto = String(entrada?.texto || '').trim().slice(0, 20000);
  const imagen = String(entrada?.imagen || '');
  if (!texto && !imagen) throw new ValidationError('Pega el texto del correo o una captura.');
  if (imagen && (!/^data:image\/(png|jpe?g|webp);base64,/i.test(imagen) || imagen.length > 7_000_000)) {
    throw new ValidationError('La captura debe ser PNG, JPG o WEBP de hasta 5 MB.');
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ValidationError('La lectura de correos no está configurada (falta OPENAI_API_KEY).');
  const contenido: any = imagen ? { type: 'image_url', image_url: { url: imagen } } : { type: 'text', text: `CORREO:\n${texto}` };
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey });
  let r: any;
  try {
    const resp: any = await client.chat.completions.create({
      model: 'gpt-4o-mini', max_tokens: 1024, response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT_ESCALERA }, contenido] }],
    } as any);
    const raw = String(resp?.choices?.[0]?.message?.content ?? '').replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
    r = JSON.parse(raw);
  } catch (e: any) {
    throw new ValidationError(`El lector de correos falló: ${e?.message || e}`);
  }

  const campos: Record<string, string> = {};
  for (const c of Object.keys(CAMPOS_ESCALERA)) {
    const v = String(r?.[c] ?? '').replace(/\s+/g, ' ').trim();
    if (v) campos[c] = v;
  }
  const omitidos: string[] = [];
  if (campos.salesManager && String(t.salesManager || '').trim()) { omitidos.push(`Sales Manager del correo: ${campos.salesManager}`); delete campos.salesManager; }
  const contratoCorreo = r?.contrato ? normContrato(r.contrato) : null;
  return {
    contratoCorreo,
    coincideContrato: contratoCorreo ? contratoCorreo === normContrato(t.contrato) : null,
    campos, omitidos,
  };
}
