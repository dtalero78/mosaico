/**
 * Qué agendamiento cuenta como "el de ESTA nivelación".
 *
 * El recorrido Agrupaciones → Pendientes se DERIVA de que el alumno tenga un
 * agendamiento vivo en un evento `tipo='NIVELACION'`. Pero ningún cierre cancela
 * ese agendamiento —cuando el guía la registra o Servicio la cierra sólo se toca
 * `ACADEMICA`, y el booking queda vivo como historia de asistencia, que es lo
 * correcto—, así que al aprobar la SEGUNDA nivelación de un alumno la regla
 * encontraba el agendamiento de la primera: el alumno nunca pasaba por
 * Agrupaciones y en Pendientes salía con la fecha de la nivelación vieja.
 *
 * La regla, en un solo sitio: cuenta ÚNICAMENTE el agendamiento **creado después
 * de la solicitud actual** (`ACADEMICA_BOOKINGS._createdDate` ≥
 * `detalleNivelacion.fecha`). Los dos datos existen siempre en MOSAICO: el
 * INSERT del agendamiento pone `NOW()` y la solicitud —la del guía y el alta de
 * Servicio— guarda su `fecha`. Si por un dato viejo faltara la fecha, se cae al
 * comportamiento anterior (cualquier agendamiento vivo cuenta) en vez de dejar
 * al alumno sin sesión.
 *
 * Vive en `lib/` y no en el servicio para que las pruebas la carguen sin tocar
 * la base; el servicio (`nivelacion-agendada.service`) sólo trae las filas.
 */
export interface AgendamientoBase {
  /** `ACADEMICA_BOOKINGS._createdDate` */
  creadoEn: string | Date | null | undefined
  cancelo?: boolean | null
}

function instante(v: string | Date | null | undefined): number | null {
  if (v == null || v === '') return null
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}

/**
 * ¿Este agendamiento pertenece a la nivelación pedida en `fechaSolicitud`?
 * Sin fecha de solicitud (o sin fecha de creación) no hay con qué distinguir:
 * cuenta, que es lo que hacía la regla anterior.
 */
export function esDeEstaNivelacion(
  fechaSolicitud: string | Date | null | undefined,
  creadoEn: string | Date | null | undefined
): boolean {
  const sol = instante(fechaSolicitud)
  const cre = instante(creadoEn)
  if (sol == null || cre == null) return true
  return cre >= sol
}

/**
 * De los agendamientos del alumno en eventos de nivelación, el de la solicitud
 * actual. Si hubiera más de uno (se le cambió de sesión sin cancelar la
 * anterior), manda el creado MÁS RECIENTEMENTE: es la asignación vigente.
 * Devuelve `null` cuando no tiene ninguno → sigue en Agrupaciones.
 */
export function elegirAgendamientoActual<T extends AgendamientoBase>(
  fechaSolicitud: string | Date | null | undefined,
  agendamientos: readonly T[]
): T | null {
  let elegido: T | null = null
  let mejor = -Infinity
  for (const a of agendamientos) {
    if (a.cancelo === true) continue
    if (!esDeEstaNivelacion(fechaSolicitud, a.creadoEn)) continue
    const t = instante(a.creadoEn) ?? -Infinity
    if (!elegido || t > mejor) { elegido = a; mejor = t }
  }
  return elegido
}
