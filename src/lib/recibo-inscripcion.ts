/**
 * Recibo de inscripción del contrato — reglas puras (cliente + servidor).
 *
 * El recibo es UN archivo por contrato que vive en PEOPLE."reciboInscripcion" del
 * titular, aparte de la documentación. Al subirlo la IA lo lee; lo leído se guarda
 * con el recibo, se copia a FINANCIEROS.recibo* y, si el monto cuadra con la
 * inscripción, precarga la cuota #0 (medio, fecha, referencia) — SIN validarla:
 * la validación sigue siendo de Recaudos.
 */

import { mediosPagoPara } from './medios-pago';

/** Lo que la IA extrae del comprobante. */
export interface ReciboExtraido {
  medioPago: string | null;
  fecha: string | null;        // YYYY-MM-DD
  monto: number | null;
  referencia: string | null;
  banco: string | null;
  confianza: number | null;    // 0..1
}

export type EstadoLectura = 'PENDIENTE' | 'OK' | 'FALLIDA';

/** Forma de PEOPLE."reciboInscripcion" (y de cada entrada del historial). */
export interface ReciboInscripcion {
  url: string;
  nombre: string | null;
  tipo: string | null;
  subidoPor: string | null;
  subidoEn: string;
  lectura: EstadoLectura;
  lecturaError?: string | null;
  extraido: ReciboExtraido | null;
  /** Cuando Recaudos corrige o confirma lo leído. */
  revisadoPor?: string | null;
  revisadoEn?: string | null;
  /** Sólo en el historial: cuándo dejó de ser el vigente y por qué. */
  reemplazadoEn?: string;
  origen?: 'MODAL' | 'MIGRACION' | 'RECAUDOS';
}

/**
 * Tipos admitidos para el RECIBO (la documentación admite además audios).
 * HEIC queda fuera a propósito: la lectura con IA no lo acepta, y un recibo que
 * no se puede leer no cumple su función — se pide la foto en JPG o el PDF.
 */
export const TIPOS_RECIBO = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
export const EXT_RECIBO = ['jpg', 'jpeg', 'png', 'webp', 'pdf'];
export const ACCEPT_RECIBO = [...TIPOS_RECIBO, ...EXT_RECIBO.map(e => `.${e}`)].join(',');

/**
 * Tamaño máximo del recibo: el MISMO para subirlo y para leerlo. En LGS se
 * aceptaba subir 20 MB pero sólo se leían 8, y el recibo grande se perdía.
 */
export const MAX_MB_RECIBO = 15;

export function reciboPermitido(tipo?: string | null, nombre?: string | null): boolean {
  const t = String(tipo || '').toLowerCase();
  if (TIPOS_RECIBO.includes(t)) return true;
  const e = String(nombre || '').split('.').pop()?.toLowerCase() || '';
  return EXT_RECIBO.includes(e);
}

/** Convierte "115.000", "$115,000.00" o 115000 en número. null si no se puede. */
export function aNumero(x: unknown): number | null {
  if (x === null || x === undefined || x === '') return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const s = String(x).trim();
  // Un solo separador seguido de 1-2 dígitos al final = decimales; el resto son miles.
  const m = s.match(/^[^\d-]*(-?[\d.,\s]+)/);
  if (!m) return null;
  const d = m[1].replace(/\s/g, '');
  if (!/\d/.test(d)) return null; // "sin monto" no es 0
  const dec = d.match(/[.,](\d{1,2})$/);
  let entero = dec ? d.slice(0, -dec[0].length) : d;
  entero = entero.replace(/[.,]/g, '');
  const n = Number(dec ? `${entero}.${dec[1]}` : entero);
  return Number.isFinite(n) ? n : null;
}

/**
 * ¿El monto leído es el de la inscripción? Se tolera 1 peso de diferencia
 * (redondeos de la pasarela). Si falta cualquiera de los dos, no se puede decir
 * que coincide — y entonces no se precarga nada.
 */
export function montoCoincide(montoLeido: number | null, inscripcion: number | null): boolean {
  if (montoLeido === null || inscripcion === null) return false;
  if (!(inscripcion > 0)) return false;
  return Math.abs(montoLeido - inscripcion) <= 1;
}

const sinAcentos = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Traduce el medio que leyó la IA ("WebPay", "Transferencia"…) a una opción del
 * catálogo de la plataforma. Si no corresponde a ninguna, null: la cuota conserva
 * el medio que se capturó al crear el contrato — escribir un valor que el
 * desplegable no ofrece lo dejaría imposible de volver a elegir al editar.
 */
export function medioDelCatalogo(medioLeido: string | null | undefined, plataforma?: string | null): string | null {
  if (!medioLeido) return null;
  const leido = sinAcentos(medioLeido);
  const opciones = mediosPagoPara(plataforma || undefined);
  const exacto = opciones.find(o => sinAcentos(o) === leido);
  if (exacto) return exacto;
  // "Transferencia bancaria", "Webpay Plus"… → la opción cuyo nombre contiene.
  const contiene = opciones.find(o => leido.includes(sinAcentos(o)));
  return contiene || null;
}

/** Normaliza lo que devuelve la IA (o lo que corrige el gestor) a la forma guardada. */
export function normalizarExtraido(c: Partial<Record<keyof ReciboExtraido, unknown>> | null | undefined): ReciboExtraido {
  const x = c || {};
  const texto = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v).trim();
    return s ? s.slice(0, 120) : null;
  };
  const fecha = typeof x.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.fecha.trim()) ? x.fecha.trim() : null;
  const conf = aNumero(x.confianza);
  return {
    medioPago: texto(x.medioPago),
    fecha,
    monto: aNumero(x.monto),
    referencia: texto(x.referencia),
    banco: texto(x.banco),
    confianza: conf === null ? null : Math.max(0, Math.min(1, conf)),
  };
}

/** Resumen de una línea: "Webpay · $115.000 · 2026-09-30 · ref 12345". */
export function resumenRecibo(e: ReciboExtraido | null | undefined): string {
  if (!e) return '';
  const partes: string[] = [];
  if (e.medioPago) partes.push(e.medioPago);
  if (e.monto !== null && e.monto !== undefined) partes.push(`$${Number(e.monto).toLocaleString('es-CL')}`);
  if (e.fecha) partes.push(e.fecha);
  if (e.referencia) partes.push(`ref ${e.referencia}`);
  return partes.join(' · ');
}
