/**
 * Módulo del curso puente WELCOME según el CURSO real del alumno. Cliente + servidor.
 *
 * Cada grupo de cursos ve SOLO los eventos WELCOME de su módulo:
 *  - IMPULSA                     → 'IMPULSA'
 *  - YOJI / OKINA / KODOMO       → 'MOSKIDS'   (menores)
 *  - DANSHI / SENPAI             → 'MOSADULTOS' (adultos)
 *
 * Se usa para (a) filtrar qué eventos WELCOME ve/agenda cada alumno y (b) el módulo
 * con el que nace su ACADEMICA en el puente WELCOME.
 */
export type WelcomeModulo = 'IMPULSA' | 'MOSKIDS' | 'MOSADULTOS';

export function welcomeModuloForCurso(tipoCurso?: string | null): WelcomeModulo {
  const t = String(tipoCurso || '').trim().toUpperCase();
  if (t.startsWith('IMPULSA')) return 'IMPULSA';
  if (t === 'DANSHI' || t === 'SENPAI') return 'MOSADULTOS';
  // YOJI / OKINA / KODOMO (y default) → menores
  return 'MOSKIDS';
}

/**
 * ¿Los mensajes de bienvenida / link de perfil de este curso van al APODERADO
 * (en vez de al alumno)? Cursos de menores de edad: YOJI, OKINA, KODOMO y DANSHI.
 * SENPAI e IMPULSA son de mayores → el mensaje va al propio alumno.
 * (Distinto de `esMenores`, que NO incluye DANSHI.)
 */
export function cursoUsaApoderadoParaMensajes(tipoCurso?: string | null): boolean {
  const t = String(tipoCurso || '').trim().toUpperCase();
  return t === 'YOJI' || t === 'OKINA' || t === 'KODOMO' || t === 'DANSHI';
}
