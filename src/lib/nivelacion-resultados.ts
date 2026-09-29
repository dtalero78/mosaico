/**
 * Cómo se MUESTRA cada resultado de una nivelación cerrada (`NivelacionHistory`).
 *
 * Vive en `lib/` porque lo pintan dos pantallas —el Histórico de Servicio y el
 * historial de la ficha del alumno— y cada una tenía su propia lista: la ficha
 * sólo conocía REALIZADA y NO_ASISTIO, así que un cierre de Servicio salía con
 * el código crudo (`NO_ASISTIO_JUSTIFICO`). Con una sola definición, estrenar un
 * resultado nuevo es agregarlo aquí.
 */
export interface MetaResultadoNivelacion {
  label: string
  cls: string
}

export const RESULTADO_NIVELACION_META: Record<string, MetaResultadoNivelacion> = {
  PENDIENTE:  { label: 'Pendiente',  cls: 'bg-amber-100 text-amber-700' },
  APROBADA:   { label: 'Aprobada',   cls: 'bg-blue-100 text-blue-700' },
  REALIZADA:  { label: 'Realizada',  cls: 'bg-green-100 text-green-700' },
  NO_ASISTIO: { label: 'No asistió', cls: 'bg-red-100 text-red-700' },
  // La canceló el sistema el jueves 22:00 porque nadie confirmó. Se distingue
  // de "No asistió": aquí la clase nunca llegó a programarse.
  CANCELADA_SIN_CONFIRMAR: { label: 'Cancelada (sin confirmar)', cls: 'bg-gray-200 text-gray-700' },
  // Cierres que aplica Servicio desde Pendientes. Se distinguen del "No asistió"
  // del guía porque no son el mismo caso para quien hace seguimiento: uno avisó
  // y el otro nunca respondió.
  NO_ASISTIO_JUSTIFICO:    { label: 'No asistió — justificó',   cls: 'bg-blue-100 text-blue-700' },
  NO_ASISTIO_NO_CONTESTO:  { label: 'No asistió — no contestó', cls: 'bg-red-100 text-red-700' },
  // La quitó Servicio desde Agrupaciones, antes de agendarla. Tampoco llegó a
  // programarse, pero aquí fue una decisión de una persona, con su motivo.
  REMOVIDA: { label: 'Removida', cls: 'bg-orange-100 text-orange-700' },
}

export function metaResultadoNivelacion(estado?: string | null): MetaResultadoNivelacion {
  const clave = String(estado || '').trim()
  return RESULTADO_NIVELACION_META[clave] || { label: clave || '—', cls: 'bg-gray-100 text-gray-600' }
}
