/**
 * Utilidades de "cuestionarios" — una lección de Evaluación puede tener VARIOS
 * cuestionarios (cada uno con su título, tiempo y preguntas). El alumno los
 * presenta TODOS en orden.
 *
 * Compatibilidad: las lecciones antiguas guardaban un solo set en
 * `preguntasManual`; se tratan como 1 cuestionario ("Cuestionario 1").
 *
 * Funciones puras (sin `server-only`): las usan endpoints y el editor cliente.
 */
export interface CuestionarioPregunta {
  id?: any;
  type?: string;
  question?: string;
  options?: any[];
  correctAnswer?: any;
  explanation?: string;
}
export interface Cuestionario {
  id: string;
  titulo: string;
  minutos: number;
  preguntas: CuestionarioPregunta[];
}

export function parseJsonArray(x: any): any[] {
  try {
    const a = Array.isArray(x) ? x : typeof x === 'string' ? JSON.parse(x || '[]') : [];
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

const clampMin = (m: any, fallback = 30) => {
  const n = Math.round(Number(m));
  return Number.isFinite(n) && n >= 1 && n <= 180 ? n : fallback;
};

/**
 * Deriva la lista de cuestionarios de una fila de NIVELES.
 * Prioriza `cuestionarios`; si está vacío pero hay `preguntasManual` (MANUAL),
 * devuelve 1 cuestionario legacy con el tiempo de la lección.
 */
export function deriveCuestionarios(row: {
  cuestionarios?: any;
  preguntasManual?: any;
  evaluacionModo?: string | null;
  evaluacionMinutos?: number | null;
}): Cuestionario[] {
  const raw = parseJsonArray(row?.cuestionarios);
  if (raw.length) {
    return raw.map((c: any, i: number) => ({
      id: String(c?.id ?? `c${i + 1}`),
      titulo: String(c?.titulo ?? `Cuestionario ${i + 1}`).trim() || `Cuestionario ${i + 1}`,
      minutos: clampMin(c?.minutos, clampMin(row?.evaluacionMinutos)),
      preguntas: parseJsonArray(c?.preguntas),
    }));
  }
  const legacy = parseJsonArray(row?.preguntasManual);
  if (legacy.length && String(row?.evaluacionModo).toUpperCase() === 'MANUAL') {
    return [{ id: 'c1', titulo: 'Cuestionario 1', minutos: clampMin(row?.evaluacionMinutos), preguntas: legacy }];
  }
  return [];
}

/** Quita respuesta correcta/explicación de las preguntas (para el alumno). */
export function sanitizeCuestionarios(cs: Cuestionario[]): Cuestionario[] {
  return cs.map((c) => ({
    id: c.id,
    titulo: c.titulo,
    minutos: c.minutos,
    preguntas: (c.preguntas || []).map((q: any, i: number) => ({
      id: q?.id ?? i,
      type: q?.type || 'multiple_choice',
      question: q?.question || '',
      // short_answer: las `options` son las respuestas aceptadas → NO se envían al alumno.
      options: q?.type === 'short_answer' ? [] : (Array.isArray(q?.options) ? q.options : []),
    })),
  }));
}

/** Normaliza un texto de respuesta para comparación: sin acentos, minúsculas y
 *  SIN espacios (así `a^2 + 2a + 1` == `a^2+2a+1`, útil en matemáticas). */
export function normRespuesta(s: any): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, '');
}

/**
 * ¿La respuesta del alumno es correcta? MC/VF: igualdad exacta con la opción
 * correcta. short_answer: coincide (normalizada, sin acentos/mayúsculas/espacios)
 * con CUALQUIERA de las respuestas aceptadas (options ∪ correctAnswer).
 */
export function esRespuestaCorrecta(q: any, selected: any): boolean {
  if (selected == null) return false;
  if (q?.type === 'short_answer') {
    const aceptadas = [q?.correctAnswer, ...(Array.isArray(q?.options) ? q.options : [])]
      .map((a: any) => normRespuesta(a)).filter((a: string) => a.length > 0);
    return aceptadas.includes(normRespuesta(selected));
  }
  return String(selected) === String(q?.correctAnswer ?? '');
}

/** Normaliza + valida un cuestionario para guardar. Devuelve {limpio, errores}. */
export function normalizarCuestionario(c: any, idx: number): { limpio: Cuestionario; errores: string[] } {
  const errores: string[] = [];
  const titulo = String(c?.titulo ?? '').trim() || `Cuestionario ${idx + 1}`;
  const minutos = clampMin(c?.minutos);
  const preguntas = parseJsonArray(c?.preguntas).map((q: any, i: number) => {
    const n = i + 1;
    const type = q?.type === 'true_false' ? 'true_false' : q?.type === 'short_answer' ? 'short_answer' : 'multiple_choice';
    const question = String(q?.question ?? '').trim();
    // short_answer: `options` = respuestas aceptadas.
    const options = Array.isArray(q?.options) ? q.options.map((o: any) => String(o ?? '').trim()).filter((o: string) => o.length) : [];
    let correctAnswer = String(q?.correctAnswer ?? '').trim();
    if (!question) errores.push(`«${titulo}» P${n}: sin enunciado.`);
    if (type === 'short_answer') {
      if (!options.length) errores.push(`«${titulo}» P${n}: respuesta escrita sin respuestas aceptadas.`);
      if (!correctAnswer) correctAnswer = options[0] || '';
    } else if (type === 'true_false') {
      if (!['Verdadero', 'Falso'].includes(correctAnswer)) errores.push(`«${titulo}» P${n}: verdadero/falso sin correcta.`);
    } else {
      if (options.length < 2) errores.push(`«${titulo}» P${n}: necesita 2+ opciones.`);
      if (!correctAnswer || !options.includes(correctAnswer)) errores.push(`«${titulo}» P${n}: la correcta no coincide con una opción.`);
    }
    return { id: q?.id ?? `q${n}`, type, question, options, correctAnswer, explanation: String(q?.explanation ?? '') };
  });
  if (!preguntas.length) errores.push(`«${titulo}»: sin preguntas.`);
  return { limpio: { id: String(c?.id ?? `c${idx + 1}`), titulo, minutos, preguntas }, errores };
}
