/**
 * Alcance de un listado que se muestra "por guía".
 *
 *  - El rol GUIA ve SÓLO lo suyo (`soloPropios`). Su guía es el de la SESIÓN y
 *    el que venga pedido en la consulta se ignora: si dependiera del parámetro,
 *    cualquiera podría pedir lo de otro guía.
 *  - Los demás roles ven todo y pueden filtrar por el guía que elijan.
 *
 * Si el usuario es GUIA pero no se pudo resolver su ficha, `guiaId` queda en
 * `null` con `soloPropios` en `true`: quien consulta debe devolver la lista
 * VACÍA, nunca la de todos.
 *
 * Es una función pura (la ficha del guía se resuelve fuera, en
 * `guia-sesion.service`) para poder probar la decisión sin tocar la base.
 */
export interface AlcancePorGuia {
  soloPropios: boolean
  guiaId: string | null
}

export function resolverAlcancePorGuia(input: {
  esGuia: boolean
  /** `GUIAS._id` del usuario logueado (sólo se mira si es guía). */
  guiaDeSesion?: string | null
  /** El guía que pide el filtro de la pantalla. */
  guiaPedido?: string | null
}): AlcancePorGuia {
  if (input.esGuia) {
    const propio = String(input.guiaDeSesion || '').trim()
    return { soloPropios: true, guiaId: propio || null }
  }
  const pedido = String(input.guiaPedido || '').trim()
  return { soloPropios: false, guiaId: pedido || null }
}

/** Con este alcance, ¿hay que responder la lista vacía sin consultar? */
export const alcanceSinResultados = (a: AlcancePorGuia): boolean => a.soloPropios && !a.guiaId

/**
 * ¿Puede esta sesión ver el panel de alumnos del guía `guiaPedido`?
 *
 *  - El rol GUIA, sólo el suyo, aunque su rol tuviera el permiso de ver todos.
 *  - Los demás, cualquiera si tienen el permiso de ver todos; si no, sólo el
 *    propio (un coordinador que además dicta cursos tiene ficha de guía).
 *
 * Nunca vale un pedido vacío: sin guía pedido no hay panel que mostrar.
 */
export function puedeVerPanelGuia(input: {
  esGuia: boolean
  verTodos: boolean
  guiaDeSesion?: string | null
  guiaPedido?: string | null
}): boolean {
  const pedido = String(input.guiaPedido || '').trim()
  if (!pedido) return false
  const propio = String(input.guiaDeSesion || '').trim()
  if (input.esGuia) return !!propio && propio === pedido
  return input.verTodos || (!!propio && propio === pedido)
}
