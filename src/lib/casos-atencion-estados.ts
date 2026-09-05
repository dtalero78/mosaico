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
  | 'PRE_JURIDICO' | 'SIN_CONTACTO' | 'REMITIDO_A_COORDINACION'
  | 'REMITIDO_A_SERVICIO_ACADEMICO' | 'REMITIDO_A_NIVELACION' | 'REMITIDO_A_FINANZAS'
  | 'SALON_CAMBIADO' | 'HOLD_ACTIVADO' | 'NIVELACION_AGENDADA';

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
  'REMITIDO_A_SERVICIO_ACADEMICO',
  'REMITIDO_A_NIVELACION',
  'REMITIDO_A_COORDINACION',
  'REMITIDO_A_FINANZAS',
  'SIN_CONTACTO',
];

/** Todos los que se pueden elegir (abierto + los de cierre). */
export const ESTADOS: EstadoCaso[] = [ESTADO_ABIERTO, ...ESTADOS_CIERRE];

export const ESTADO_LABEL: Record<EstadoCaso, string> = {
  EN_GESTION: 'En gestión — mantiene abierto',
  RESUELTO: 'Cerrado',
  PROCESO_DE_CIERRE: 'En Proceso de Cierre',
  CIERRA_PROGRAMA: 'Cierre financiero',   // fusionado; sólo para datos viejos
  PROPUESTA_DE_CAMBIO: 'Curso Cambiado',
  REMITIDO_A_SERVICIO_ACADEMICO: 'Servicio Académico',
  REMITIDO_A_NIVELACION: 'Nivelación',
  REMITIDO_A_FINANZAS: 'Derivado Finanzas',
  SALON_CAMBIADO: 'Salón Cambiado',
  HOLD_ACTIVADO: 'Hold Activado',
  NIVELACION_AGENDADA: 'Nivelación Agendada',
  REMITIDO_A_ACADEMICA: 'Cambio de Nivel',
  PROGRAMA_CONGELADO: 'Solicitud Congelamiento',
  PRE_JURIDICO: 'Envío Pre-jurídico',
  SIN_CONTACTO: 'Sin poder contactar',
  REMITIDO_A_COORDINACION: 'Remitido a Coordinación',
};

/** Etiqueta de un estado, tolerando valores desconocidos o legados. */
export function estadoLabel(e: string | null | undefined): string {
  if (!e) return '—';
  return ESTADO_LABEL[e as EstadoCaso] || e;
}

/**
 * Las áreas que gestionan un caso cerrado. Un estado pertenece a un área
 * cuando su resolución la trabaja esa área — por eso "Cerrado" y "Sin poder
 * contactar" no están en ninguna: no dejan nada pendiente para nadie.
 */
export const ESTADOS_ACADEMICOS: EstadoCaso[] = [
  'REMITIDO_A_SERVICIO_ACADEMICO', // el genérico del botón Asignar
  'REMITIDO_A_ACADEMICA',     // Cambio de Nivel
  'PROGRAMA_CONGELADO',       // Solicitud Congelamiento
];

/**
 * Lo que queda a cargo del Coordinador Académico. Está aparte de
 * ESTADOS_ACADEMICOS porque no es lo mismo: aquéllos piden un trámite
 * concreto sobre el alumno (moverlo de curso, de nivel, congelarlo),
 * mientras que éste es la decisión que el Coordinador todavía debe tomar.
 */
export const ESTADOS_COORDINACION: EstadoCaso[] = [
  'REMITIDO_A_COORDINACION',
  'PROPUESTA_DE_CAMBIO',      // Cambio Curso: la decisión de mover a un alumno
                              // de curso la toma el Coordinador, no Académica.
];

/**
 * Los que quedan a cargo del área de Nivelaciones: el caso deriva en que al
 * alumno hay que reforzarle un punto del curso.
 */
export const ESTADOS_NIVELACION: EstadoCaso[] = [
  'REMITIDO_A_NIVELACION',
];

export const ESTADOS_FINANCIEROS: EstadoCaso[] = [
  'REMITIDO_A_FINANZAS',      // el genérico del botón Asignar
  'PROCESO_DE_CIERRE',        // En Proceso de Cierre
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
  REMITIDO_A_COORDINACION: 'bg-teal-100 text-teal-800',
  REMITIDO_A_SERVICIO_ACADEMICO: 'bg-indigo-100 text-indigo-800',
  REMITIDO_A_NIVELACION: 'bg-orange-100 text-orange-800',
  REMITIDO_A_FINANZAS: 'bg-rose-100 text-rose-800',
  SALON_CAMBIADO: 'bg-indigo-100 text-indigo-800',
  HOLD_ACTIVADO: 'bg-violet-100 text-violet-800',
  NIVELACION_AGENDADA: 'bg-orange-100 text-orange-800',
};

export function estadoColor(e: string | null | undefined): string {
  return ESTADO_COLOR[e as EstadoCaso] || 'bg-gray-100 text-gray-700';
}


/* ────────────────────────────────────────────────────────────────────────────
 * ÁREA y ESTADO son dos cosas distintas.
 *
 * El ÁREA dice a qué bandeja pertenece el caso y se conserva mientras el área
 * lo trabaje. El ESTADO dice en qué punto va esa gestión. Con un solo campo,
 * marcar "en gestión" un caso de Nivelaciones habría borrado que era de
 * Nivelaciones — por eso el área vive en su propia columna.
 * ──────────────────────────────────────────────────────────────────────────── */

export type AreaCaso = 'ACADEMICOS' | 'NIVELACIONES' | 'COORDINADOR' | 'FINANCIEROS';

export const AREAS: AreaCaso[] = [
  'ACADEMICOS', 'NIVELACIONES', 'COORDINADOR', 'FINANCIEROS',
];

export const AREA_LABEL: Record<AreaCaso, string> = {
  ACADEMICOS: 'Servicio Académico',
  NIVELACIONES: 'Nivelación',
  COORDINADOR: 'Coordinador Académico',
  FINANCIEROS: 'Área Financiera',
};

/** Nombre de la PESTAÑA de cada área (el label de arriba es el del destino). */
export const AREA_PESTANA: Record<AreaCaso, string> = {
  ACADEMICOS: 'Académicos',
  NIVELACIONES: 'Nivelaciones',
  COORDINADOR: 'Coordinador',
  FINANCIEROS: 'Financieros',
};

export const AREA_COLOR: Record<AreaCaso, string> = {
  ACADEMICOS: 'bg-indigo-100 text-indigo-800',
  NIVELACIONES: 'bg-orange-100 text-orange-800',
  COORDINADOR: 'bg-teal-100 text-teal-800',
  FINANCIEROS: 'bg-rose-100 text-rose-800',
};

/** El estado con el que un caso ENTRA a un área al asignarlo. */
export const ESTADO_AL_ASIGNAR: Record<AreaCaso, EstadoCaso> = {
  ACADEMICOS: 'REMITIDO_A_SERVICIO_ACADEMICO',
  NIVELACIONES: 'REMITIDO_A_NIVELACION',
  COORDINADOR: 'REMITIDO_A_COORDINACION',
  FINANCIEROS: 'REMITIDO_A_FINANZAS',
};

/**
 * Estados que SACAN el caso de su bandeja y lo mandan al Histórico.
 *
 * Los sub-estados de área cierran porque son el resultado de la gestión: una vez
 * cambiado el salón, no queda nada por hacer ahí. La excepción es "En Proceso de
 * Cierre", que describe algo todavía en curso y por eso el caso sigue a la vista
 * de Finanzas.
 */
export const ESTADOS_QUE_CIERRAN: EstadoCaso[] = [
  'RESUELTO',
  'SIN_CONTACTO',
  'SALON_CAMBIADO',
  'HOLD_ACTIVADO',
  'NIVELACION_AGENDADA',
  'PROPUESTA_DE_CAMBIO',   // Curso Cambiado
  'PROGRAMA_CONGELADO',
  'PRE_JURIDICO',
  'CIERRA_PROGRAMA',
];

export function cierraElCaso(e: string | null | undefined): boolean {
  return !!e && ESTADOS_QUE_CIERRAN.includes(e as EstadoCaso);
}

/**
 * Lo que ofrece el desplegable de la ficha del alumno según el área asignada.
 * "En gestión" y "Cerrado" están en todas; lo demás es propio del área.
 */
export const ESTADOS_POR_AREA: Record<AreaCaso, EstadoCaso[]> = {
  ACADEMICOS:   ['EN_GESTION', 'SALON_CAMBIADO', 'HOLD_ACTIVADO', 'RESUELTO'],
  NIVELACIONES: ['EN_GESTION', 'NIVELACION_AGENDADA', 'RESUELTO'],
  COORDINADOR:  ['EN_GESTION', 'PROPUESTA_DE_CAMBIO', 'REMITIDO_A_FINANZAS', 'RESUELTO'],
  FINANCIEROS:  ['EN_GESTION', 'PROCESO_DE_CIERRE', 'RESUELTO'],
};

/**
 * Estados que MUEVEN el caso a otra área en vez de cerrarlo. Hoy sólo uno:
 * Coordinación puede pasarle el caso a Finanzas sin darlo por terminado.
 */
export const TRASLADA_A_AREA: Partial<Record<EstadoCaso, AreaCaso>> = {
  REMITIDO_A_FINANZAS: 'FINANCIEROS',
};
