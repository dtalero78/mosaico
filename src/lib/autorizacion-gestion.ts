/**
 * Autorización de Coordinación para que el GUÍA gestione algo que ya se le venció
 * (columna "Autoriza" de Académico › Procesos sin gestión).
 *
 * Tres clases de proceso, una sola regla:
 *   - SESION        → una fila de CALENDARIO. Vence a las 24 h del inicio.
 *   - EVENTO_ADMIN  → una fila de ADMIN_EVENTS. Vence 24 h después de su fin.
 *   - REPORTE       → el informe semanal de un salón. Vence al terminar su semana.
 *
 * Dentro de su plazo el guía NO necesita autorización (la regla de siempre); la
 * autorización sólo reabre lo vencido. Dura hasta que el guía lo gestiona o hasta
 * que alguien con el permiso la desmarca.
 *
 * Cliente + servidor (sin `server-only`): la pantalla y los endpoints arman la
 * misma llave, y con una copia en cada lado la primera corrección las desalinea.
 */

import { getSessionWindow } from './session-window';
import { getAdminEventWindow } from './admin-event-window';
import { esSemanaPasada } from './reporte-academico-ventana';

export const TIPOS_AUTORIZACION = ['SESION', 'EVENTO_ADMIN', 'REPORTE'] as const;
export type TipoAutorizacion = typeof TIPOS_AUTORIZACION[number];

export function esTipoAutorizacion(v: unknown): v is TipoAutorizacion {
  return typeof v === 'string' && (TIPOS_AUTORIZACION as readonly string[]).includes(v);
}

/** Valor de `motivoCierre` cuando el guía cierra algo vencido gracias a la autorización. */
export const MOTIVO_CIERRE_AUTORIZADO = 'AUTORIZADO';

/** Tope por llamada; la pantalla parte los lotes más grandes. */
export const MAX_AUTORIZACIONES_POR_LOTE = 500;

export interface ReporteRef {
  campaign: string;
  curso: string;
  salon: string;
  /** Lunes de la semana, `YYYY-MM-DD`. */
  semanaInicio: string;
}

const limpio = (v: unknown) => String(v ?? '').trim();

/**
 * Llave de un informe semanal. El informe no tiene fila propia mientras está en
 * borrador, así que se identifica por la misma cuaterna que su cierre:
 * (campaña, curso, salón, semana) — el mismo "Salón 06" existe en varias campañas.
 */
export function refReporte(r: ReporteRef): string {
  return [limpio(r.campaign), limpio(r.curso), limpio(r.salon), limpio(r.semanaInicio).slice(0, 10)].join('|');
}

/** ¿La cuaterna está completa y la semana bien escrita? */
export function reporteRefValida(r: Partial<ReporteRef> | null | undefined): r is ReporteRef {
  if (!r) return false;
  return !!limpio(r.campaign) && !!limpio(r.curso) && !!limpio(r.salon)
    && /^\d{4}-\d{2}-\d{2}$/.test(limpio(r.semanaInicio).slice(0, 10))
    // El separador no puede venir dentro de un valor: partiría la llave.
    && ![r.campaign, r.curso, r.salon].some(v => limpio(v).includes('|'));
}

export const MENSAJE_PIDE_AUTORIZACION =
  'Plazo vencido: pide a Coordinación que lo autorice.';

// ── ¿Ya se le venció al guía? ────────────────────────────────────────────────
// Se pregunta con las MISMAS funciones de ventana que usan la pantalla y el
// servidor al dejarlo (o no) gestionar, y con el rol GUIA fijo: "vencido" es una
// propiedad del proceso frente al guía, no de quien esté mirando la lista.

/** La sesión ya pasó las 24 h en que el guía puede registrarla. */
export function sesionVencida(dia: Date | string | null | undefined, now: Date = new Date()): boolean {
  return getSessionWindow(dia, 'GUIA', now).isExpired;
}

/** El evento administrativo ya pasó su plazo (24 h después de su fin). */
export function eventoAdminVencido(
  fechaInicio: Date | string | null | undefined,
  horas: number | null | undefined,
  now: Date = new Date(),
): boolean {
  return getAdminEventWindow(fechaInicio, 'GUIA', now, horas).isExpired;
}

/** El informe es de una semana ya terminada (su plazo era esa misma semana). */
export function reporteVencido(semanaInicio: string | null | undefined, now: Date = new Date()): boolean {
  return esSemanaPasada(semanaInicio, now);
}
