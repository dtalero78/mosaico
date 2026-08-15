import 'server-only';
import crypto from 'crypto';

/**
 * El `eventoCompartidoId` de un evento se **deriva**, no se guarda.
 *
 * `generarEventosCurso` borra y recrea los eventos del curso cada vez que se
 * edita (cambio de guía, horario, fechas, suspensión de sesión, festivos…), así
 * que un enlace guardado entre eventos quedaría apuntando a filas borradas y el
 * grupo se rompería en silencio — y sin aviso, porque hay cinco flujos que
 * disparan la regeneración.
 *
 * Como esto es una fórmula sobre dos datos estables — el id del grupo (que vive
 * en `CURSOS_CAMPAIGN` y no se borra nunca) y el instante del evento — dos
 * eventos del mismo grupo a la misma hora obtienen SIEMPRE el mismo id, se
 * calcule cuando se calcule. Regenerar un curso reconstruye el vínculo solo.
 *
 * Vive aparte de [grupo-horario.ts](./grupo-horario.ts) (cliente+servidor) para
 * no arrastrar `crypto` de Node al bundle del navegador.
 *
 * El formato es el de un UUID, que es lo que la columna admite; no pretende ser
 * aleatorio: su gracia es justamente ser reproducible.
 *
 * @param instanteLocal fecha+hora LOCAL del evento (`"2026-08-22 09:00"`), no el
 *   UTC. `generarEventosCurso` deja que la BD convierta a UTC con `AT TIME ZONE`,
 *   así que en JS no se conoce el offset — y no hace falta: los cursos de un
 *   grupo comparten horario, luego comparten esta clave. Usar la hora local
 *   además esquiva el cambio de horario de septiembre en Chile.
 */
export function eventoCompartidoIdDeGrupo(grupoHorarioId: string, instanteLocal: string): string {
  const h = crypto.createHash('md5').update(`${grupoHorarioId}|${instanteLocal}`).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join('-');
}
