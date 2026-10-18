/**
 * Los criterios que el Guía valora de cada alumno (cliente + servidor).
 *
 * Vivían dentro de `reporte-academico.service`, que es `server-only`; salen aquí
 * porque ahora también los usa el Panel del guía (cálculo puro y testeable). El
 * servicio los re-exporta con el mismo nombre, así nadie más cambia.
 *
 * Los 8 tienen DOS fuentes:
 *  1. La rúbrica que el Guía marca en cada sesión (/sesion/[id], columna `col`
 *     del agendamiento), sólo en sesiones asistidas con `rubricaEvaluada`.
 *  2. Lo que se corrige A MANO en el Reporte Académico, guardado en
 *     REPORTE_ACADEMICO_NOTAS."criterios" (JSONB) por (estudiante, salón, semana).
 * Manda la 2: si se tocó el óvalo en el reporte, ese valor reemplaza al de las
 * sesiones de esa semana.
 */
export const METRICAS_MANUALES = [
  { key: 'puntual', label: 'Puntual', grupo: 'HÁBITOS', col: 'hePuntualidad' },
  { key: 'asignacion', label: 'Asignación', grupo: 'HÁBITOS', col: 'heAsignacion' },
  { key: 'dominio', label: 'Dominio', grupo: 'DESEMPEÑO', col: 'daDominio' },
  { key: 'participo', label: 'Participó', grupo: 'DESEMPEÑO', col: 'participacion' },
  { key: 'desafio', label: 'Desafío', grupo: 'DESEMPEÑO', col: 'daDesafio' },
  { key: 'activo', label: 'Activo', grupo: 'ACTITUDES', col: 'acPermanencia' },
  { key: 'respeto', label: 'Respeto', grupo: 'ACTITUDES', col: 'acRespeto' },
  // Hasta oct-2026 «cámara y micrófono» era UN criterio (acDisposicion); al
  // separarlo, lo guardado se copió a los dos (scripts/split-camara-microfono.js).
  { key: 'camara', label: 'Cámara', grupo: 'ACTITUDES', col: 'acDisposicion' },
  { key: 'microfono', label: 'Micrófono', grupo: 'ACTITUDES', col: 'acMicrofono' },
] as const;

export type ClaveCriterio = typeof METRICAS_MANUALES[number]['key'];
export type GrupoCriterio = typeof METRICAS_MANUALES[number]['grupo'];

export const ESTADOS_CRITERIO = ['full', 'half', 'empty'] as const;
export type EstadoCriterio = typeof ESTADOS_CRITERIO[number];

/** Cuánto vale cada marca manual al convertirla en porcentaje. */
export const VALOR_ESTADO_CRITERIO: Record<EstadoCriterio, number> = { full: 1, half: 0.5, empty: 0 };

/** Deja sólo las claves conocidas con estado válido (defensa del JSONB). */
export function sanitizeCriterios(input: any): Record<string, EstadoCriterio> {
  const out: Record<string, EstadoCriterio> = {};
  let obj = input;
  if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { obj = null; } }
  if (!obj || typeof obj !== 'object') return out;
  for (const m of METRICAS_MANUALES) {
    const v = obj[m.key];
    if ((ESTADOS_CRITERIO as readonly string[]).includes(v)) out[m.key] = v;
  }
  return out;
}
