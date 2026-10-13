/**
 * Bienvenida "pendiente de agendar" (MOSAICO).
 *
 * Un alumno queda pendiente cuando sigue en el curso puente WELCOME, ya creó su
 * perfil en /nuevo-usuario y no tiene NINGUNA bienvenida agendada (no cancelada).
 * Esa pertenencia se CALCULA al leer (`findWelcomePendientesAgendar`): en cuanto
 * Servicio le agenda una sesión, sale solo de la cola.
 *
 * Lo que sí se guarda (ACADEMICA."welcomePendienteMotivo") es POR QUÉ quedó sin
 * agendar, para que Servicio sepa si el alumno lo pidió o si no había sesiones.
 * Cliente + servidor: lo usan el alta de perfil y la pestaña de Servicio.
 */

export type MotivoWelcomePendiente =
  | 'SOLICITUD_USUARIO'  // marcó "Prefiero que Servicio me contacte"
  | 'SOLO_PERFIL'        // entró por el enlace de sólo perfil (?noWelcome=1)
  | 'SIN_SESIONES'       // no había sesiones WELCOME en los próximos 14 días
  | 'NO_AGENDADO';       // eligió una sesión pero no se pudo agendar (llena / no existe)

export const MOTIVO_WELCOME_PENDIENTE_LABEL: Record<MotivoWelcomePendiente, string> = {
  SOLICITUD_USUARIO: 'Lo pidió el usuario',
  SOLO_PERFIL: 'Enlace de sólo perfil',
  SIN_SESIONES: 'No había sesiones disponibles',
  NO_AGENDADO: 'La sesión elegida no se pudo agendar',
};

/** Etiqueta del motivo. Sin motivo = perfil creado antes de que existiera el registro. */
export function etiquetaMotivoWelcomePendiente(motivo: string | null | undefined): string {
  return MOTIVO_WELCOME_PENDIENTE_LABEL[motivo as MotivoWelcomePendiente] || 'Sin registro de motivo';
}

/**
 * Motivo a registrar al completar el perfil SIN bienvenida agendada.
 * El orden importa: lo que el alumno decidió manda sobre lo que pasó.
 */
export function motivoWelcomePendiente(opts: {
  omitirWelcome: boolean;
  soloPerfil: boolean;
  eligioSesion: boolean;
}): MotivoWelcomePendiente {
  if (opts.omitirWelcome) return 'SOLICITUD_USUARIO';
  if (opts.soloPerfil) return 'SOLO_PERFIL';
  if (opts.eligioSesion) return 'NO_AGENDADO';
  return 'SIN_SESIONES';
}
