/**
 * Reemplazo de placeholders en plantillas de mensajes.
 *
 * Soportados (claves sin {{}}):
 *   - nombre          → primerNombre del estudiante
 *   - nombreCompleto  → primerNombre + primerApellido
 *   - nivel           → nivel
 *   - step            → step
 *   - plataforma      → plataforma
 *   - contrato        → contrato
 *   - numeroId        → numeroId
 *   - linkPerfil      → enlace PERSONAL para crear el perfil del alumno
 *                       (`/nuevo-usuario/<ACADEMICA._id>`, el mismo que manda la
 *                       aprobación). Lo resuelve el servidor por el documento.
 *
 * Cualquier placeholder no soportado se reemplaza por cadena vacía (no
 * rompe el envío). El regex coincide con `{{ key }}` con espacios opcionales.
 *
 * Cliente Y servidor.
 */

export interface RecipientContext {
  numeroId?: string | null;
  nombre?: string | null;          // primerNombre
  primerApellido?: string | null;
  nivel?: string | null;
  step?: string | null;
  plataforma?: string | null;
  contrato?: string | null;
  /** ACADEMICA._id del alumno: arma {{linkPerfil}}. */
  academicaId?: string | null;
  /** Dominio de la plataforma para {{linkPerfil}}. */
  baseUrl?: string | null;
}

export const BASE_URL_PLATAFORMA = 'https://mosaicosorobanplataforma.com';

/** Enlace para crear el perfil: el mismo que va en el WhatsApp de aprobación. */
export function linkPerfil(academicaId?: string | null, baseUrl?: string | null): string {
  if (!academicaId) return '';
  return `${String(baseUrl || BASE_URL_PLATAFORMA).replace(/\/+$/, '')}/nuevo-usuario/${academicaId}`;
}

/** ¿La plantilla usa el enlace de perfil? Si sí, cada destinatario necesita su registro académico. */
export function usaLinkPerfil(template: string): boolean {
  return /\{\{\s*linkPerfil\s*\}\}/.test(template || '');
}

/** Lista única de placeholders válidos — el editor de plantillas la usa para auto-sugerir. */
export const AVAILABLE_PLACEHOLDERS = [
  'nombre',
  'nombreCompleto',
  'nivel',
  'step',
  'plataforma',
  'contrato',
  'numeroId',
  'linkPerfil',
] as const;

export type PlaceholderKey = typeof AVAILABLE_PLACEHOLDERS[number];

function valueFor(ctx: RecipientContext, key: string): string {
  switch (key) {
    case 'nombre':         return (ctx.nombre ?? '').trim();
    case 'nombreCompleto': return [ctx.nombre, ctx.primerApellido].filter(Boolean).join(' ').trim();
    case 'nivel':          return (ctx.nivel ?? '').trim();
    case 'step':           return (ctx.step ?? '').trim();
    case 'plataforma':     return (ctx.plataforma ?? '').trim();
    case 'contrato':       return (ctx.contrato ?? '').trim();
    case 'numeroId':       return (ctx.numeroId ?? '').trim();
    case 'linkPerfil':     return linkPerfil(ctx.academicaId, ctx.baseUrl);
    default:               return ''; // placeholder desconocido → vacío
  }
}

/**
 * Llena la plantilla con los datos del destinatario. Acepta `{{ key }}` con
 * espacios opcionales adentro.
 */
export function fillTemplate(template: string, ctx: RecipientContext): string {
  if (!template) return '';
  return template.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (_, key: string) => {
    return valueFor(ctx, key);
  });
}

/**
 * Extrae todos los placeholders usados en una plantilla. Útil para validar
 * en el editor o para auto-poblar la columna `placeholders` de la tabla.
 */
export function extractPlaceholders(template: string): string[] {
  if (!template) return [];
  const set = new Set<string>();
  const rx = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(template)) !== null) {
    set.add(m[1]);
  }
  return Array.from(set);
}
