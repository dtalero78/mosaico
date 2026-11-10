import 'server-only';
import { query } from '@/lib/postgres';
import { ids } from '@/lib/id-generator';

/**
 * Auditoría de cambios de PEOPLE.aprobacion (tabla APROBACION_AUDIT, solo INSERT).
 * La tabla la crea scripts/create-aprobacion-audit.js (sin DDL en el request path).
 *
 * Registrar es BEST-EFFORT: si la tabla no existe o el INSERT falla, se loguea y
 * NO se rompe la operación de negocio (el cambio de estado ya se hizo).
 */

export type OrigenAprobacion =
  | 'FICHA_ESTADO_TITULAR'   // selector "Estado del Titular" en /person/[id]
  | 'APROBAR'                // POST /people/[id]/approve (botón Aprobar / selector → Aprobado)
  | 'APROBAR_CASCADA'        // beneficiarios aprobados al aprobar el titular, o titular auto-aprobado
  | 'PANTALLA_APROBACION'    // PUT /approvals/[id] (/dashboard/aprobacion)
  | 'WIX_LEGACY'             // POST /wix/updateTitularEstado
  | 'VERIFICACION_CREAR_CONTRATO' // anulación del registro/contrato anterior al crear uno nuevo
  | 'SISTEMA';               // procesos automáticos

export interface CambioAprobacion {
  personId: string;
  contrato?: string | null;
  tipoUsuario?: string | null;
  nombre?: string | null;
  estadoAnterior?: string | null;
  estadoNuevo: string | null;
  origen: OrigenAprobacion;
  motivo?: string | null;
  /** Sesión de NextAuth (o null si lo hace el sistema). */
  session?: any;
  /** Actor explícito cuando no hay sesión (p. ej. 'sistema'). */
  actor?: string | null;
}

export async function registrarCambioAprobacion(c: CambioAprobacion): Promise<void> {
  const anterior = (c.estadoAnterior ?? '') || null;
  const nuevo = (c.estadoNuevo ?? '') || null;
  if (anterior === nuevo) return; // no hubo cambio real
  const u = c.session?.user as any;
  try {
    await query(
      `INSERT INTO "APROBACION_AUDIT"
         ("_id","personId","contrato","tipoUsuario","nombre","estadoAnterior","estadoNuevo",
          "origen","motivo","usuarioEmail","usuarioNombre","usuarioRol","_createdDate")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
      [
        ids.audit(),
        c.personId, c.contrato ?? null, c.tipoUsuario ?? null, c.nombre ?? null,
        anterior, nuevo, c.origen, (c.motivo || '').trim() || null,
        u?.email ?? c.actor ?? null, u?.name ?? null, u?.role ?? null,
      ]
    );
  } catch (err: any) {
    console.warn('⚠️ [aprobacion-audit] no se pudo registrar el cambio:', err?.message || err);
  }
}

/** Nombre legible "Primer Apellido" de una fila PEOPLE. */
export function nombreDe(p: any): string | null {
  const n = [p?.primerNombre, p?.primerApellido].filter(Boolean).join(' ').trim();
  return n || null;
}
