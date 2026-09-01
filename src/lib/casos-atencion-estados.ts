/**
 * Estados de un Caso de Atención: valores, etiquetas y a qué área pertenece cada uno.
 *
 * Vive fuera de `casos-atencion.service.ts` (que es `server-only`) porque las
 * MISMAS etiquetas las usan el dropdown de la ficha del alumno, el informe de
 * Servicio y Casos Usuarios. Antes estaban copiadas en tres archivos y ya habían
 * empezado a divergir: renombrar un estado obligaba a acordarse de los tres.
 */

export type EstadoCaso =
  | 'EN_GESTION' | 'RESUELTO' | 'PROCESO_DE_CIERRE' | 'PROPUESTA_DE_CAMBIO'
  | 'CIERRA_PROGRAMA' | 'REMITIDO_A_ACADEMICA' | 'PROGRAMA_CONGELADO'
  | 'PRE_JURIDICO' | 'SIN_CONTACTO';

/** El único estado que deja el caso ABIERTO. Es el "Pendiente" del informe. */
export const ESTADO_ABIERTO: EstadoCaso = 'EN_GESTION';

/**
 * `CIERRA_PROGRAMA` se fusionó con `PROCESO_DE_CIERRE` bajo el nombre "Cierre
 * financiero": eran dos estados para lo mismo y al renombrarlos habrían quedado
 * con la misma etiqueta, indistinguibles al filtrar.
 *
 * El valor sigue existiendo en el ENUM de PostgreSQL — quitarlo obliga a recrear
 * el tipo y no aporta nada — pero ya NO se ofrece al elegir estado. Los casos
 * que lo tuvieran se migran, y `estadoLabel` lo sigue traduciendo por si queda
 * alguno en el historial.
 */
export const ESTADO_RETIRADO: EstadoCaso = 'CIERRA_PROGRAMA';

/** Estados que CIERRAN el caso, en el orden en que se ofrecen. */
export const ESTADOS_CIERRE: EstadoCaso[] = [
  'RESUELTO',
  'PROCESO_DE_CIERRE',
  'PROPUESTA_DE_CAMBIO',
  'REMITIDO_A_ACADEMICA',
  'PROGRAMA_CONGELADO',
  'PRE_JURIDICO',
  'SIN_CONTACTO',
];

/** Todos los que se pueden elegir (abierto + los de cierre). */
export const ESTADOS: EstadoCaso[] = [ESTADO_ABIERTO, ...ESTADOS_CIERRE];

export const ESTADO_LABEL: Record<EstadoCaso, string> = {
  EN_GESTION: 'En gestión — mantiene abierto',
  RESUELTO: 'Cerrado',
  PROCESO_DE_CIERRE: 'Cierre financiero',
  CIERRA_PROGRAMA: 'Cierre financiero',   // fusionado; sólo para datos viejos
  PROPUESTA_DE_CAMBIO: 'Cambio Curso',
  REMITIDO_A_ACADEMICA: 'Cambio de Nivel',
  PROGRAMA_CONGELADO: 'Solicitud Congelamiento',
  PRE_JURIDICO: 'Envío Pre-jurídico',
  SIN_CONTACTO: 'Sin poder contactar',
};

/** Etiqueta de un estado, tolerando valores desconocidos o legados. */
export function estadoLabel(e: string | null | undefined): string {
  if (!e) return '—';
  return ESTADO_LABEL[e as EstadoCaso] || e;
}

/**
 * Las dos áreas que gestionan un caso cerrado. Un estado pertenece a un área
 * cuando su resolución la trabaja esa área — por eso "Cerrado" y "Sin poder
 * contactar" no están en ninguna: no dejan nada pendiente para nadie.
 */
export const ESTADOS_ACADEMICOS: EstadoCaso[] = [
  'PROPUESTA_DE_CAMBIO',      // Cambio Curso
  'REMITIDO_A_ACADEMICA',     // Cambio de Nivel
  'PROGRAMA_CONGELADO',       // Solicitud Congelamiento
];

export const ESTADOS_FINANCIEROS: EstadoCaso[] = [
  'PROCESO_DE_CIERRE',        // Cierre financiero
  'CIERRA_PROGRAMA',          // idem (legado fusionado)
  'PRE_JURIDICO',             // Envío Pre-jurídico
];

/** Color del badge por estado. El abierto en ámbar; cada área con su tono. */
export const ESTADO_COLOR: Record<EstadoCaso, string> = {
  EN_GESTION: 'bg-amber-100 text-amber-800',
  RESUELTO: 'bg-gray-100 text-gray-700',
  PROCESO_DE_CIERRE: 'bg-rose-100 text-rose-800',
  CIERRA_PROGRAMA: 'bg-rose-100 text-rose-800',
  PROPUESTA_DE_CAMBIO: 'bg-sky-100 text-sky-800',
  REMITIDO_A_ACADEMICA: 'bg-indigo-100 text-indigo-800',
  PROGRAMA_CONGELADO: 'bg-violet-100 text-violet-800',
  PRE_JURIDICO: 'bg-red-100 text-red-800',
  SIN_CONTACTO: 'bg-stone-100 text-stone-700',
};

export function estadoColor(e: string | null | undefined): string {
  return ESTADO_COLOR[e as EstadoCaso] || 'bg-gray-100 text-gray-700';
}
