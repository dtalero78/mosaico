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
 * @param exprNombre  expresión SQL que resuelve el nombre completo
 * @param exprDoc     expresión SQL que resuelve el documento
 * @param texto       lo que tecleó el usuario
 * @param i           índice del próximo placeholder ($i, $i+1)
 */
export function condicionUsuarioSql(
  exprNombre: string,
  exprDoc: string,
  texto: string,
  i: number
): { sql: string; params: string[] } {
  const doc = normalizeNumeroId(texto)
  return {
    sql: `(${exprNombre} ILIKE $${i} OR REGEXP_REPLACE(UPPER(COALESCE(${exprDoc}, '')), '[.\\s\\-_]', '', 'g') LIKE $${i + 1})`,
    params: [`%${texto}%`, `%${doc}%`],
  }
}

/** El nombre completo tal como lo arman los informes, para usarlo en un WHERE. */
export function exprNombreCompleto(alias = 'p'): string {
  return `TRIM(REGEXP_REPLACE(CONCAT_WS(' ', ${alias}."primerNombre", ${alias}."segundoNombre", ${alias}."primerApellido", ${alias}."segundoApellido"), '\\s+', ' ', 'g'))`
}
