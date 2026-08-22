import 'server-only';
import { ValidationError } from './errors';
import { esFestivoChile } from './festivos-chile';

/**
 * Un evento no puede caer en un día sin clase: ni feriado legal de Chile ni día
 * declarado por Académico. Vale para crear un evento y para mover uno a esa fecha.
 *
 * Los cursos de campaña ya lo respetan al generarse, pero los eventos sueltos
 * (Welcome, nivelaciones, talleres) se crean a mano y nada los detenía — por eso
 * llegó a haber un Welcome el 18 de septiembre, que es feriado legal.
 *
 * Los días declarados se leen de la base; si la consulta falla (tabla aún no
 * creada) queda el calendario legal, que no depende de la base.
 */
export async function assertNoEsFestivo(fecha: string): Promise<void> {
  const f = String(fecha || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return;

  if (esFestivoChile(f)) {
    throw new ValidationError(`El ${f} es feriado en Chile — ese día no se dicta clase.`);
  }

  const { fechasFestivasPersonalizadas } = await import('@/services/festivos-personalizados.service');
  const declarados = await fechasFestivasPersonalizadas().catch(() => new Set<string>());
  if (declarados.has(f)) {
    throw new ValidationError(
      `El ${f} está declarado como día sin clase en Académico › Sesiones › Festivos.`
    );
  }
}
