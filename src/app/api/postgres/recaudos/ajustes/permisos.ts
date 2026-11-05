import 'server-only';
import type { Session } from 'next-auth';
import { RecaudosPermission, type Permission } from '@/types/permissions';
import type { TipoAjuste } from '@/services/pagos-ajustes.service';

/** Permiso de cada subpestaña de Ajustes. */
export function permisoAjuste(tipo: TipoAjuste): Permission {
  if (tipo === 'INSCRIPCION') return RecaudosPermission.AJUSTES_INSCRIPCION as Permission;
  if (tipo === 'PAGO') return RecaudosPermission.AJUSTES_PAGO as Permission;
  return RecaudosPermission.AJUSTES_FACTURACION as Permission;
}

export const PERMISOS_AJUSTE = [
  RecaudosPermission.AJUSTES_INSCRIPCION,
  RecaudosPermission.AJUSTES_PAGO,
  RecaudosPermission.AJUSTES_FACTURACION,
] as Permission[];

export function sessionInfo(session: Session | null) {
  const u = (session as any)?.user;
  return { email: u?.email ?? null, nombre: u?.name ?? null, role: String(u?.role ?? '') };
}
