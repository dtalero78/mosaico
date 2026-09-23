import { normalizeNumeroId } from '@/lib/numeroid-normalize'

/**
 * Condición SQL para el filtro «Usuario» de los informes: busca por NOMBRE o por
 * DOCUMENTO en una sola caja de texto.
 *
 * Vive aquí porque los cuatro endpoints de Nivelaciones la necesitan y cada uno
 * la escribe sobre una fuente distinta — unos sobre las tablas (`p."numeroId"`),
 * el Histórico sobre una CTE donde el nombre ya es una columna. Copiarla en cada
 * archivo la habría dejado divergir a la primera corrección.
 *
 * El documento se normaliza a AMBOS lados: se teclea como se lee (24.777.856-k)
 * y está guardado sin puntos ni guión (24777856K), así que compararlos crudos
 * no encontraría nada.
 *
 * El CONTRATO es opcional (hoy sólo lo usa Casos de Atención) y reusa el mismo
 * parámetro normalizado que el documento: `01-M5-2341-26` queda `01M5234126`, así
 * que lo encuentra tecleado entero, como `2341-26` o sólo `2341`.
 *
 * @param exprNombre    expresión SQL que resuelve el nombre completo
 * @param exprDoc       expresión SQL que resuelve el documento
 * @param texto         lo que tecleó el usuario
 * @param i             índice del próximo placeholder ($i, $i+1)
 * @param exprContrato  expresión SQL que resuelve el nº de contrato (opcional)
 */
export function condicionUsuarioSql(
  exprNombre: string,
  exprDoc: string,
  texto: string,
  i: number,
  exprContrato?: string
): { sql: string; params: string[] } {
  const doc = normalizeNumeroId(texto)
  const normalizado = (expr: string) =>
    `REGEXP_REPLACE(UPPER(COALESCE(${expr}, '')), '[.\\s\\-_]', '', 'g') LIKE $${i + 1}`
  const contrato = exprContrato ? ` OR ${normalizado(exprContrato)}` : ''
  return {
    sql: `(${exprNombre} ILIKE $${i} OR ${normalizado(exprDoc)}${contrato})`,
    params: [`%${texto}%`, `%${doc}%`],
  }
}

/** El nombre completo tal como lo arman los informes, para usarlo en un WHERE. */
export function exprNombreCompleto(alias = 'p'): string {
  return `TRIM(REGEXP_REPLACE(CONCAT_WS(' ', ${alias}."primerNombre", ${alias}."segundoNombre", ${alias}."primerApellido", ${alias}."segundoApellido"), '\\s+', ' ', 'g'))`
}
