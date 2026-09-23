/**
 * Qué cuenta como "sesión de curso" en los informes de Casos de Atención.
 *
 * La lista estaba escrita dos veces —en `casos-atencion/asistencia` y en
 * `sesiones-vacias`— y hay que mantenerlas iguales: si una excluye un tipo y la
 * otra no, un mismo evento cuenta como inasistencia en un informe y no en el
 * otro. Vive aquí para que ampliarla sea un solo cambio.
 *
 * Los dos informes miran la CLASE REGULAR del curso: a quién le faltó su clase
 * de la semana, y qué clase se dictó sin nadie. Todo lo demás es un evento
 * aparte, con su propia gestión, y por eso queda fuera:
 *
 *   CLUB / OLIMPIADA  — actividades, no la clase del curso
 *   WELCOME           — la sesión de bienvenida, previa al curso
 *   NIVELACION        — refuerzo puntual, con su propio circuito en Servicio
 *   COMPLEMENTARIA    — quiz que el alumno resuelve solo
 *   RECUPERACION      — repone una clase perdida (típicamente en la semana de
 *                       festivos). Se dicta y se le toma asistencia como a
 *                       cualquier sesión, pero NO debe generar casos: el alumno
 *                       que no va a la reposición no está faltando a su clase.
 */
export const TIPOS_FUERA_DE_CASOS = [
  'CLUB', 'NIVELACION', 'COMPLEMENTARIA', 'WELCOME', 'OLIMPIADA', 'RECUPERACION',
] as const;

/** Los tipos anteriores, listos para un `NOT IN (...)` de SQL. */
export const TIPOS_FUERA_DE_CASOS_SQL = TIPOS_FUERA_DE_CASOS.map(t => `'${t}'`).join(',');

/**
 * Cómo se llama el tipo de un agendamiento EN PANTALLA.
 *
 * El valor guardado es `CLUB` —así se creó, así se sigue creando y así lo
 * comparan las reglas—, pero en MOSAICO esa actividad se llama **Taller** y así
 * aparece en el resto de la aplicación. Se traduce sólo al mostrarlo: renombrar
 * el dato obligaría a tocar las decenas de sitios que comparan `tipo === 'CLUB'`
 * y dejaría los 68.000 agendamientos ya guardados con el valor viejo.
 *
 * Vive aquí para que las cinco pantallas que muestran el tipo de un agendamiento
 * digan lo mismo; con una copia en cada una, la primera corrección las desalinea.
 */
export function etiquetaTipoEvento(tipo?: string | null): string {
  const t = String(tipo || '').trim();
  return t.toUpperCase() === 'CLUB' ? 'Taller' : t;
}
