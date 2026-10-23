import 'server-only';
import { queryOne } from '@/lib/postgres';

/**
 * Auto-avance de MÓDULO por ASISTENCIA — DESACTIVADO (oct-2026).
 *
 * La posición del alumno (módulo y lección) ya no depende de su asistencia sino de las
 * sesiones que su salón ya dictó: la mueve el cron `avance-calendario`
 * (avance-calendario.service). Se conserva la función, sin efecto, porque la llaman las
 * vías que guardan asistencia o evaluación; así ninguna tiene que cambiar y no hay dos
 * reglas pisándose. La asistencia sigue alimentando «¿Cómo voy?» como diagnóstico.
 */
export async function autoAvanceModuloMosaico(_academicaId: string): Promise<{ advanced: boolean; from?: string; to?: string }> {
  return { advanced: false };
}

/**
 * Lo mismo, partiendo de un AGENDAMIENTO: para los guardados que sólo conocen el
 * booking. Hoy no tiene efecto (ver arriba); se conserva para no tocar a los llamadores.
 * Best-effort: nunca lanza.
 */
export async function autoAvanceModuloPorBooking(bookingId: string): Promise<{ advanced: boolean; from?: string; to?: string }> {
  try {
    const b = await queryOne<{ id: string | null }>(
      `SELECT COALESCE("idEstudiante","studentId") AS id FROM "ACADEMICA_BOOKINGS" WHERE "_id"=$1`,
      [bookingId]
    );
    if (!b?.id) return { advanced: false };
    return await autoAvanceModuloMosaico(b.id);
  } catch {
    return { advanced: false };
  }
}
