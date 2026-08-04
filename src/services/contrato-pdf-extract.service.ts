import 'server-only';
import {
  clean, normId, parseFecha, normPrograma, normHorario, normalizeContractNumber,
} from '@/lib/contrato-import';

/**
 * Extrae los datos de un contrato desde el TEXTO de su PDF (plantilla MOSAICO o
 * IMPULSA) usando OpenAI, y los mapea a la forma que consume
 * `/api/admin/migrar-contrato` (→ createFullContract). Campos vacíos quedan vacíos;
 * las dudas se acumulan en `inconsistencias` (no se lanza error).
 */

const PROMPT = `Eres un extractor de datos de contratos de inscripción de MOSAICO/IMPULSA PAES (Chile).
Del TEXTO del contrato extrae SOLO lo que esté presente. Devuelve JSON con esta forma EXACTA
(usa "" o [] para lo que falte, NO inventes):
{
 "esImpulsa": boolean,               // true si el programa es "IMPULSA PAES" o el N.º empieza en 6-
 "contrato": "",                     // "Contrato Online N.º ..." tal cual (ej "5-1569-25")
 "titular": {
   "primerNombre":"", "segundoNombre":"", "primerApellido":"", "segundoApellido":"",
   "rut":"", "fechaNacimiento":"", "domicilio":"", "ciudad":"", "telefonoCasa":"", "celular":"",
   "email":"", "ingresos":"", "empresa":"", "cargo":"", "genero":""
 },
 "apoderado": { "nombre":"", "telefono":"", "email":"" },
 "referencias": [ { "nombre":"", "telefono":"", "parentesco":"" } ],   // 0..2
 "beneficiarios": [ {                 // "Usuario1", "Usuario2"... (puede ser 1 o varios)
   "primerNombre":"", "segundoNombre":"", "primerApellido":"", "segundoApellido":"",
   "rut":"", "fechaNacimiento":"", "domicilio":"", "email":"", "celular":"",
   "programa":"", "horario":""        // programa: YOJI/OKINA/KODOMO/DANSHI/SENPAI o "IMPULSA PAES"; horario tal cual
 } ],
 "financial": {
   "totalPlan":"", "inscripcion":"", "saldo":"", "numeroCuotas":"", "valorCuota":"",
   "formaPago":"", "valorPagado":"", "fechaPrimerPago":""
 },
 "asesor": { "nombre":"", "correo":"" },   // de "ESCALA COMERCIAL": Asesor training + Email
 "observaciones":""
}
Reglas de nombre (convención chilena: normalmente 1-2 nombres + 2 apellidos paterno/materno):
si el "Nombre Completo" tiene 3 palabras, asume 1 nombre + 2 apellidos (NO 2 nombres + 1 apellido);
si tiene 4, 2 nombres + 2 apellidos. Ejemplo: "Lautaro Díaz Antiñir" → primerNombre "Lautaro",
primerApellido "Díaz", segundoApellido "Antiñir".
Montos: deja solo dígitos (sin $ ni puntos), ej "$900.000" → "900000".
Fechas: conviértelas a formato YYYY-MM-DD si puedes (ej "10 DE JULIO DE 2025" → "2025-07-10", "12/01/1985" → "1985-01-12").
El RUT déjalo como aparece. Responde SOLO el JSON.`;

function toNum(s: any): number {
  const d = String(s || '').replace(/[^\d]/g, '');
  return d ? parseInt(d, 10) : 0;
}

export interface ExtractResult {
  esImpulsa: boolean;
  contrato: string;
  titular: Record<string, any>;
  beneficiarios: Record<string, any>[];
  financial: Record<string, any>;
  titularEsBeneficiario: boolean;
  inconsistencias: string[];
  textoLargo: number;
}

/** Extrae texto del PDF (buffer). */
async function pdfToText(buffer: Buffer): Promise<string> {
  const mod: any = await import('pdf-parse/lib/pdf-parse.js' as any);
  const pdf = mod.default || mod;
  const data = await pdf(buffer);
  return String(data?.text || '');
}

export async function extraerContratoDePdf(buffer: Buffer): Promise<ExtractResult> {
  const inconsistencias: string[] = [];
  const texto = (await pdfToText(buffer)).trim();
  if (texto.length < 40) {
    // PDF sin capa de texto (probable escaneo) → no hay nada que extraer.
    throw Object.assign(new Error('El PDF no tiene texto extraíble (¿es un escaneo? requiere OCR).'), { code: 'NO_TEXT' });
  }

  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: texto.slice(0, 12000) },
    ],
  });
  let raw: any = {};
  try { raw = JSON.parse(response.choices?.[0]?.message?.content || '{}'); }
  catch { throw new Error('No se pudo interpretar la extracción del PDF.'); }

  const esImpulsa = !!raw.esImpulsa;
  const t = raw.titular || {};
  const titularNumeroId = normId(t.rut);
  if (!titularNumeroId) inconsistencias.push('Titular sin RUT/número de identificación.');
  if (!clean(t.primerNombre) || !clean(t.primerApellido)) inconsistencias.push('Titular sin nombre/apellido completo.');

  const ap = raw.apoderado || {};
  const refs: any[] = Array.isArray(raw.referencias) ? raw.referencias : [];
  const asesor = raw.asesor || {};
  const fin = raw.financial || {};

  const titular: Record<string, any> = {
    primerNombre: clean(t.primerNombre), segundoNombre: clean(t.segundoNombre) || null,
    primerApellido: clean(t.primerApellido), segundoApellido: clean(t.segundoApellido) || null,
    numeroId: titularNumeroId,
    fechaNacimiento: parseFecha(t.fechaNacimiento) || null,
    domicilio: clean(t.domicilio) || null, ciudad: clean(t.ciudad) || null,
    telefono: clean(t.telefonoCasa) || null, celular: clean(t.celular).replace(/[^\d]/g, '') || null,
    email: clean(t.email) || null,
    ingresos: toNum(t.ingresos) || null, empresa: clean(t.empresa) || null, cargo: clean(t.cargo) || null,
    genero: clean(t.genero) || null,
    plataforma: 'Chile',
    asesor: clean(asesor.nombre) || null,
    asesorMail: clean(asesor.correo) || null,
    apoderado: clean(ap.nombre) || null,
    apoderadoTelefono: clean(ap.telefono).replace(/[^\d]/g, '') || null,
    apoderadoMail: clean(ap.email) || null,
    referenciaUno: clean(refs[0]?.nombre) || null,
    parentezcoRefUno: clean(refs[0]?.parentesco) || null,
    telRefUno: clean(refs[0]?.telefono).replace(/[^\d]/g, '') || null,
    referenciaDos: clean(refs[1]?.nombre) || null,
    parentezcoRefDos: clean(refs[1]?.parentesco) || null,
    telRefDos: clean(refs[1]?.telefono).replace(/[^\d]/g, '') || null,
    esCursoImpulsa: esImpulsa,
  };

  const beneficiarios: Record<string, any>[] = (Array.isArray(raw.beneficiarios) ? raw.beneficiarios : [])
    .filter((b: any) => b && (clean(b.primerNombre) || clean(b.rut)))
    .map((b: any, i: number) => {
      const tipoCurso = normPrograma(b.programa);
      let horarioCurso = normHorario(b.horario);
      if (tipoCurso === 'IMPULSA' && !horarioCurso) horarioCurso = 'LUN-MIÉ-VIE 20:00-21:00';
      if (b.programa && !tipoCurso) inconsistencias.push(`Beneficiario ${i + 1}: programa "${clean(b.programa)}" no reconocido.`);
      if (b.horario && !horarioCurso) inconsistencias.push(`Beneficiario ${i + 1}: horario "${clean(b.horario)}" no se pudo mapear a un curso.`);
      const numeroId = normId(b.rut);
      if (!numeroId) inconsistencias.push(`Beneficiario ${i + 1}: sin RUT.`);
      return {
        primerNombre: clean(b.primerNombre), segundoNombre: clean(b.segundoNombre) || null,
        primerApellido: clean(b.primerApellido), segundoApellido: clean(b.segundoApellido) || null,
        numeroId,
        fechaNacimiento: parseFecha(b.fechaNacimiento) || null,
        email: clean(b.email) || null, celular: clean(b.celular).replace(/[^\d]/g, '') || null,
        domicilio: clean(b.domicilio) || null,
        tipoCurso, horarioCurso, campaign: null,
        // apoderado heredado del titular (los beneficiarios menores lo comparten)
        apoderado: titular.apoderado, apoderadoTelefono: titular.apoderadoTelefono, apoderadoMail: titular.apoderadoMail,
      };
    });
  if (!beneficiarios.length) inconsistencias.push('No se detectó ningún beneficiario/usuario.');

  // Titular es beneficiario si su numeroId coincide con el de algún beneficiario.
  const titularEsBeneficiario = beneficiarios.some(b => b.numeroId && b.numeroId === titular.numeroId);

  const numeroCuotas = toNum(fin.numeroCuotas);
  const financial = {
    totalPlan: toNum(fin.totalPlan) || null,
    pagoInscripcion: toNum(fin.inscripcion) || null,
    saldo: toNum(fin.saldo) || null,
    numeroCuotas: numeroCuotas || null,
    valorCuota: toNum(fin.valorCuota) || null,
    formaPago: clean(fin.formaPago) || null,
    medioPago: clean(fin.formaPago) || null,
    fechaPago: parseFecha(fin.fechaPrimerPago) || null,
    tipoPlan: numeroCuotas > 1 ? 'Credito' : (fin.totalPlan ? 'Contado' : null),
    vigencia: esImpulsa ? null : (numeroCuotas ? String(numeroCuotas) : null),
  };
  if (!financial.totalPlan) inconsistencias.push('Sin valor total del plan (financiero incompleto).');

  const contrato = normalizeContractNumber(raw.contrato, esImpulsa);
  if (!contrato) inconsistencias.push('Sin número de contrato.');

  return { esImpulsa, contrato, titular, beneficiarios, financial, titularEsBeneficiario, inconsistencias, textoLargo: texto.length };
}
