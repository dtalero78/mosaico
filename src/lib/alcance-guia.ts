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
