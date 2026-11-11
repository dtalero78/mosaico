/**
 * Regla única del COMENTARIO al cambiar el estado de aprobación de una matrícula
 * (client-safe: la usan los modales y las rutas del servidor).
 *
 *  - Aprobar el CONTRATO (titular, o en cascada sus beneficiarios): sin comentario;
 *    queda registrado quién lo aprobó, fecha y hora (APROBACION_AUDIT).
 *  - Aprobar un BENEFICIARIO con su botón: comentario obligatorio (puede ser una
 *    adición o el reemplazo de un beneficiario existente).
 *  - Cualquier otro estado (Rechazado, Devuelto, Contrato nulo, Pendiente, Retractado…):
 *    comentario obligatorio (por qué se rechaza, se devuelve, etc.).
 *  - Cambios automáticos del sistema: nunca piden comentario; quedan como "Sistema".
 *
 * El comentario se guarda en APROBACION_AUDIT.motivo y se ve en el Seguimiento.
 */

export const MIN_COMENTARIO_ESTADO = 10;

export function exigeComentarioEstado(estadoNuevo: string | null | undefined, tipoUsuario?: string | null): boolean {
  if (estadoNuevo === 'Aprobado') return String(tipoUsuario || '').toUpperCase() === 'BENEFICIARIO';
  return true;
}

export function comentarioValido(c: string | null | undefined): boolean {
  return String(c ?? '').trim().length >= MIN_COMENTARIO_ESTADO;
}

export function mensajeComentarioEstado(estadoNuevo: string | null | undefined): string {
  return estadoNuevo === 'Aprobado'
    ? `Para aprobar un beneficiario escribe un comentario (mínimo ${MIN_COMENTARIO_ESTADO} caracteres): adición o reemplazo de beneficiario, etc.`
    : `Para cambiar el estado a "${estadoNuevo || 'Sin estado'}" escribe el motivo (mínimo ${MIN_COMENTARIO_ESTADO} caracteres).`;
}
