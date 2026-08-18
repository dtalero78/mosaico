/**
 * ¿Un agendamiento tiene algo REGISTRADO que se perdería al borrarlo?
 *
 * Es la regla que separa "una fila que sólo dice que el alumno estaba inscrito"
 * de "una fila que guarda lo que pasó en la clase". La primera se puede borrar y
 * volver a crear —lo hace cada regeneración de curso—; la segunda es historia que
 * no se reconstruye, así que ningún borrado la debe llevarse por delante.
 *
 * Vivía copiada en la regeneración de cursos, en la de festivos y en el script de
 * limpieza de huérfanos. Al usarla además en los borrados de evento y de curso
 * habría quedado en cinco sitios, así que se centraliza aquí.
 *
 * Se toma la versión AMPLIA —la que tenía el script de huérfanos—, que cuenta
 * también las anotaciones del guía y los comentarios al alumno: son texto escrito
 * a mano que tampoco se reconstruye. Las dos copias de la regeneración miraban
 * sólo las seis marcas de evaluación; ampliar ahí sólo hace que se conserve más.
 *
 * ⚠ PENDIENTE, aparte de esto: la regeneración re-aplica `comentarios` pero NO
 * `advisorAnotaciones` (no está en sus STATE_COLS), así que una anotación se
 * pierde igualmente al regenerar un curso. Es una decisión de negocio, no de
 * refactor, y por eso no se toca aquí.
 *
 * Es un fragmento de SQL, no un helper de JS, porque siempre se evalúa dentro de
 * una consulta sobre muchas filas — traerlas a Node para filtrarlas sería absurdo.
 */

/**
 * Devuelve el fragmento `(... OR ...)` listo para meter en un WHERE.
 * @param alias alias de la tabla ACADEMICA_BOOKINGS en la consulta (por defecto `b`).
 */
export function bookingConRegistroSql(alias = 'b'): string {
  const a = `${alias}.`;
  return `(${a}"asistio" = true OR ${a}"asistencia" = true OR ${a}"participacion" = true
       OR ${a}"noAprobo" = true OR ${a}"cancelo" = true OR ${a}"calificacion" IS NOT NULL
       OR COALESCE(${a}"advisorAnotaciones", '') <> '' OR COALESCE(${a}"comentarios", '') <> '')`;
}
