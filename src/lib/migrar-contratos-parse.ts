/**
 * Parseo/normalización del CSV de migración de contratos MOSAICO.
 *
 * Portado 1:1 desde `scripts/migrar-contratos-csv.js` (funciones puras, sin DB ni
 * red) para que la MISMA lógica la use el script Y el endpoint `/api/admin/contratos/bulk`
 * (Subir Lote → modo Contratos). Produce el payload que consume `createFullContract`.
 *
 * NO importa 'server-only': es pura, así el endpoint la corre en servidor con el
 * texto del CSV ya decodificado por el cliente (BOM/UTF-8/latin1 se resuelven allí).
 */

// ── helpers de normalización ─────────────────────────────────────────────────
const stripAccents = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const normId = (s: unknown) => stripAccents(s).toUpperCase().replace(/[.\s\-_]/g, '').trim();
const clean = (s: unknown) => String(s ?? '').trim();

export function parseFecha(s: unknown): string | null { // "1/06/2026" → "2026-06-01"
  const m = clean(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Normaliza el nombre de campaña del CSV al de CURSOS_CAMPAIGN. */
export function normCampaign(s: unknown, campaignMap: Record<string, string> = {}): string | null {
  const u = stripAccents(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (campaignMap[u]) return campaignMap[u];
  if (u.startsWith('JUNIO')) return 'JUNIO082026';
  if (u.startsWith('AGOSTO')) return 'AGOSTO172026';
  if (u.startsWith('ABRIL')) return 'ABRIL132026';
  if (u.startsWith('SINCAMPAIGN') || u.startsWith('SINCANPAIGN')) return 'SINCAMPAIGN'; // typo tolerado
  return null; // basura → queda sin campaña (se omite)
}

const TIPOS = ['YOJI', 'OKINA', 'KODOMO', 'DANSHI', 'SENPAI', 'IMPULSA'];
function normPrograma(s: unknown): string | null {
  const u = stripAccents(s).toUpperCase().replace(/[^A-Z]/g, '');
  return TIPOS.find(t => t === u) || TIPOS.find(t => u.startsWith(t)) || null;
}

export function normHorario(s: unknown): string | null { // "Martes y Jueves 18:15-19:15" → "MAR-JUE 18:15-19:15"
  const t = stripAccents(s).toLowerCase();
  let days: string | null = null;
  if (/lun/.test(t) && /mie/.test(t) && /vie/.test(t)) days = 'LUN-MIÉ-VIE';
  else if (/lun/.test(t) && /mie/.test(t)) days = 'LUN-MIÉ';
  else if (/mar/.test(t) && /jue/.test(t)) days = 'MAR-JUE';
  else if (/sab/.test(t)) days = 'SÁB';
  const times = [...t.matchAll(/(\d{1,2}):(\d{2})/g)].map(m => `${m[1].padStart(2, '0')}:${m[2]}`);
  if (!days || times.length < 2) return null;
  return `${days} ${times[0]}-${times[1]}`;
}

export interface ParsedBenef {
  _idx: number;
  primerNombre: string; segundoNombre: string | null;
  primerApellido: string; segundoApellido: string | null;
  numeroId: string; numeroIdRaw: string;
  fechaNacimiento: string | null; domicilio: string | null;
  email: string | null; celular: string | null;
  tipoCurso: string | null; tipoCursoRaw: string;
  horarioCurso: string | null; horarioRaw: string;
  apoderado?: string | null; apoderadoTelefono?: string | null; apoderadoMail?: string | null;
  campaign?: string | null;
}

export interface ParsedContrato {
  contrato: string;
  fechaContratoCSV: string;
  campaignRaw: string;
  campaign: string | null;
  titular: any;
  financial: any;
  beneficiarios: ParsedBenef[];
  titularEsBeneficiario: boolean;
  _issues?: string[];
}

export interface ParseOpts {
  campaignForzada?: string | null;
  vigencia?: string;
  plataforma?: string;
  planForzado?: string | null;
  campaignMap?: Record<string, string>;
}

/**
 * Parsea el texto del CSV (ya decodificado) a la lista de contratos lista para
 * validar/crear. Réplica exacta del cuerpo del script.
 */
export function parseContratosCsv(text: string, opts: ParseOpts = {}): ParsedContrato[] {
  const CAMPAIGN_FORZADA = opts.campaignForzada ?? null;
  const VIGENCIA = String(opts.vigencia || '12');
  const PLATAFORMA = opts.plataforma || 'Chile';
  const PLAN_FORZADO = opts.planForzado ?? null;
  const CAMPAIGN_MAP = opts.campaignMap || {};

  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const H = lines[0].split(';').map(clean);
  const col = (row: string[], name: string) => { const i = H.indexOf(name); return i >= 0 ? clean(row[i]) : ''; };

  function buildBenef(row: string[], n: number): ParsedBenef | null {
    const prog = col(row, `programa${n}beneficiario`);
    if (!prog) return null;
    const tipoCurso = normPrograma(prog);
    let horarioCurso = normHorario(col(row, `horario${n}beneficiario`));
    if (tipoCurso === 'IMPULSA' && !horarioCurso) horarioCurso = 'LUN-MIÉ-VIE 20:00-21:00';
    return {
      _idx: n,
      primerNombre: col(row, `nombre1beneciciario${n}`),
      segundoNombre: col(row, `nombre2beneficiario${n}`) || null,
      primerApellido: col(row, `apellido1beneficiario${n}`),
      segundoApellido: col(row, `apellido2beneficiario${n}`) || null,
      numeroId: normId(col(row, `idbeneficiaio${n}`)),
      numeroIdRaw: col(row, `idbeneficiaio${n}`),
      fechaNacimiento: parseFecha(col(row, `fechanacimientobeneficiario${n}`)),
      domicilio: col(row, `domiciliobeneficiaio${n}`) || null,
      email: col(row, `emailbeneficiaio${n}`) || null,
      celular: col(row, `celularbeneficiario${n}`) || null,
      tipoCurso,
      tipoCursoRaw: prog,
      horarioCurso,
      horarioRaw: col(row, `horario${n}beneficiario`),
    };
  }

  return lines.slice(1).map((l): ParsedContrato => {
    const row = l.split(';');
    const apoderado = col(row, 'apoderadoNombre') || null;
    const apoderadoTelefono = col(row, 'apoderadoTelefono') || null;
    const titularId = normId(col(row, 'idTitular'));

    const cuotas = parseInt(col(row, 'nocuotas') || '0', 10) || 0;
    const saldo = Number(String(col(row, 'saldoplan')).replace(/\D/g, '')) || 0;
    const financial = {
      totalPlan: col(row, 'totalplan') || '0',
      pagoInscripcion: col(row, 'inscripcion') || '0',
      saldo: col(row, 'saldoplan') || '0',
      numeroCuotas: String(cuotas),
      valorCuota: cuotas > 0 ? String(Math.round(saldo / cuotas)) : '0',
      plan: PLAN_FORZADO || (cuotas > 1 ? 'Credito' : 'Contado'),
      vigencia: VIGENCIA,
    };

    const titular: any = {
      primerNombre: col(row, 'primerNombreTitular'),
      segundoNombre: col(row, 'segundoNombreTitular') || null,
      primerApellido: col(row, 'primerApellidoTitular'),
      segundoApellido: col(row, 'segundoApellidoTitular') || null,
      numeroId: titularId,
      numeroIdRaw: col(row, 'idTitular'),
      fechaNacimiento: parseFecha(col(row, 'nacimientoTitular')),
      domicilio: col(row, 'domicilioTitular') || null,
      celular: col(row, 'celularTitular') || null,
      ingresos: col(row, 'ingresoTitular') || null,
      empresa: col(row, 'empresaTitular') || null,
      cargo: col(row, 'cargoTitular') || null,
      plataforma: PLATAFORMA,
      asesor: col(row, 'asesorComercial') || null,
      asesorMail: null,
      apoderado, apoderadoTelefono, apoderadoMail: null,
      esCursoImpulsa: false,
      extemporanea: false,
      email: null,
    };

    let benefs = [buildBenef(row, 1), buildBenef(row, 2)].filter(Boolean) as ParsedBenef[];

    const campaignRaw = col(row, 'campaign');
    const hasImpulsa = benefs.some(b => b.tipoCurso === 'IMPULSA');
    let campaign = CAMPAIGN_FORZADA || normCampaign(campaignRaw, CAMPAIGN_MAP);
    if (campaign === 'SINCAMPAIGN') campaign = hasImpulsa ? 'AGOSTO172026' : 'JUNIO082026';
    else if (!campaign && hasImpulsa) campaign = 'AGOSTO172026';

    benefs.forEach(b => { b.apoderado = apoderado; b.apoderadoTelefono = apoderadoTelefono; b.apoderadoMail = null; b.campaign = campaign; });

    // titular-es-beneficiario: si un beneficiario tiene el mismo numeroId del titular
    let titularEsBeneficiario = false;
    const idxSelf = benefs.findIndex(b => b.numeroId && b.numeroId === titularId);
    if (idxSelf >= 0) {
      const self = benefs[idxSelf];
      titularEsBeneficiario = true;
      titular.tipoCurso = self.tipoCurso;
      titular.horarioCurso = self.horarioCurso;
      titular.campaign = campaign;
      titular.esCursoImpulsa = self.tipoCurso === 'IMPULSA';
      titular.email = self.email || titular.email;
      titular.domicilio = titular.domicilio || self.domicilio;
      benefs.splice(idxSelf, 1); // createFullContract lo re-agrega desde el titular
    }

    return {
      contrato: col(row, 'noContrato'),
      fechaContratoCSV: col(row, 'fechaContrato'),
      campaignRaw, campaign, titular, financial, beneficiarios: benefs, titularEsBeneficiario,
    };
  });
}
