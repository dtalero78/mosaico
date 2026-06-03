/**
 * Middleware Permissions - Sistema de permisos para Next.js middleware
 * Carga permisos desde PostgreSQL con cache para optimizar performance
 */

import { Role, Permission } from '@/types/permissions';

// Cache en memoria con TTL de 5 minutos
interface CacheEntry {
  permissions: Permission[];
  timestamp: number;
}

const permissionsCache = new Map<Role, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/**
 * Carga los permisos de un rol desde PostgreSQL (con cache)
 */
export async function getPermissionsForRoleFromWix(role: Role): Promise<Permission[]> {
  // Verificar cache
  const cached = permissionsCache.get(role);
  const now = Date.now();

  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    console.log(`🔄 [Middleware] Cache HIT para rol ${role}`);
    return cached.permissions;
  }

  console.log(`📡 [Middleware] Cargando permisos desde API para rol ${role}`);

  try {
    // Use API endpoint instead of direct PostgreSQL connection
    // Middleware runs in Edge Runtime which doesn't support pg module
    const apiUrl = process.env.NEXTAUTH_URL || 'http://localhost:3001';
    const response = await fetch(
      `${apiUrl}/api/postgres/permissions?rol=${encodeURIComponent(role)}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        next: { revalidate: 0 },
      }
    );

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.success && data.permisos) {
      const permissions = data.permisos as Permission[];

      // Actualizar cache
      permissionsCache.set(role, {
        permissions,
        timestamp: now,
      });

      console.log(`✅ [Middleware] Permisos cargados: ${permissions.length} permisos`);
      return permissions;
    }

    // Si no hay resultado, retornar array vacío
    console.warn(`⚠️ [Middleware] Rol ${role} no encontrado`);
    return [];
  } catch (error) {
    console.error(`❌ [Middleware] API error para ${role}:`, error);

    // En caso de error, usar fallback hardcodeado
    console.log(`⚠️ [Middleware] Usando permisos hardcodeados para rol ${role}`);
    const { getPermissionsByRole } = await import('@/config/roles');
    return getPermissionsByRole(role);
  }
}

/**
 * Mapeo de rutas a los permisos requeridos para acceder
 * Si la ruta coincide con alguna de estas, se verifican los permisos
 */
export const ROUTE_PERMISSIONS: Record<string, Permission[]> = {
  // Académico - Agenda Sesiones
  '/dashboard/academic/agenda-sesiones': [
    'ACADEMICO.AGENDA.VER_CALENDARIO' as Permission,
    'ACADEMICO.AGENDA.VER_AGENDA' as Permission,
    'ACADEMICO.AGENDA.CALENDARIO_VER' as Permission,
    'ACADEMICO.AGENDA.LISTA_VER' as Permission,
    'ACADEMICO.AGENDA.FILTRO' as Permission,
    'ACADEMICO.AGENDA.NUEVO_EVENTO' as Permission,
    'ACADEMICO.AGENDA.EXPORTAR_CSV' as Permission,
    'ACADEMICO.AGENDA.EDITAR' as Permission,
    'ACADEMICO.AGENDA.ELIMINAR' as Permission,
    'ACADEMICO.AGENDA.CREAR_EVENTO' as Permission,
  ],

  // Académico - Agenda Académica
  '/dashboard/academic/agenda-academica': [
    'ACADEMICO.AGENDA.VER_AGENDA_ACADEMICA' as Permission,
    'ACADEMICO.ACADEMICA.VER' as Permission,
    'ACADEMICO.ACADEMICA.AGENDAMIENTO' as Permission,
    'ACADEMICO.ACADEMICA.EXPORTAR_CSV' as Permission,
    'ACADEMICO.ACADEMICA.ESTADISTICAS' as Permission,
    'ACADEMICO.ACADEMICA.EXPORTAR_STATS_CSV' as Permission,
  ],

  // Académico - Advisors
  '/dashboard/academic/advisors': [
    'ACADEMICO.ADVISOR.LISTA_VER' as Permission, // ← TALERO tiene este
    'ACADEMICO.ADVISOR.AGREGAR' as Permission,
    'ACADEMICO.ADVISOR.ESTADISTICA' as Permission,
  ],

  // Académico - Actualizar Material
  '/dashboard/academic/actualizar-material': [
    'ACADEMICO.MATERIAL.ACTUALIZAR' as Permission,
  ],
  '/dashboard/academic/control-horas': [
    'ACADEMICO.CONTROL_HORAS.VER' as Permission,
  ],
  '/dashboard/academic/jump-evaluaciones': [
    'ACADEMICO.JUMP_EVAL.REVISAR' as Permission,
  ],
  '/dashboard/academic/performance-evaluation': [
    'ACADEMICO.PERFORMANCE_EVAL.VER' as Permission,
  ],
  '/dashboard/academic/sesiones-sin-gestion': [
    'ACADEMICO.SESIONES_SIN_GESTION.VER' as Permission,
  ],
  '/dashboard/academic/eventos-administrativos': [
    'ACADEMICO.ADMIN_EVENTS.GESTIONAR' as Permission,
  ],
  // /admin/feature-flags/performance-eval queda gateado solo por SUPER_ADMIN
  // (no aparece en sidebar para otros roles; el endpoint valida la sesión).

  // Panel Advisor
  '/panel-advisor': [
    'ACADEMICO.ADVISOR.VER_ENLACE' as Permission,
  ],

  // Servicio - Welcome Session
  '/dashboard/servicio/welcome-session': [
    'SERVICIO.WELCOME.CARGAR_EVENTOS' as Permission,
    'SERVICIO.WELCOME.EXPORTAR_CSV' as Permission,
  ],

  // Servicio - Lista de Sesiones
  '/dashboard/servicio/lista-sesiones': [
    'SERVICIO.SESIONES.CARGAR_EVENTOS' as Permission,
    'SERVICIO.SESIONES.EXPORTAR_CSV' as Permission,
  ],

  // Servicio - Usuarios sin perfil
  '/dashboard/servicio/sin-registro': [
    'SERVICIO.USUARIOS.ACTUALIZAR' as Permission,
    'SERVICIO.USUARIOS.EXPORTAR_CSV' as Permission,
  ],

  // Servicio - Exam. Intern. > IELTS / B2 First / TOEFL
  '/dashboard/servicio/exam-intern/ielts': [
    'SERVICIO.EXAM_INTERN.IELTS_VER' as Permission,
  ],
  '/dashboard/servicio/exam-intern/b2first': [
    'SERVICIO.EXAM_INTERN.B2F_VER' as Permission,
  ],
  '/dashboard/servicio/exam-intern/toefl': [
    'SERVICIO.EXAM_INTERN.TOEFL_VER' as Permission,
  ],

  // Comercial - Crear Contrato
  '/dashboard/comercial/crear-contrato': [
    'COMERCIAL.CONTRATO.MODIFICAR' as Permission,
    'COMERCIAL.CONTRATO.ENVIAR_PDF' as Permission,
    'COMERCIAL.CONTRATO.DESCARGAR' as Permission,
    'COMERCIAL.CONTRATO.APROBACION_AUTONOMA' as Permission,
  ],

  // Comercial - Prospectos
  '/dashboard/comercial/prospectos': [
    'COMERCIAL.PROSPECTOS.VER' as Permission,
  ],

  // Informes — rutas específicas por grupo
  // Nivel 3 — cada reporte con su permiso específico (nieto)
  '/dashboard/informes/asistencia/sesiones-clubes': ['INFORMES.ASISTENCIA.SESIONES' as Permission],
  '/dashboard/informes/asistencia/clubes': ['INFORMES.ASISTENCIA.CLUBES' as Permission],
  '/dashboard/informes/asistencia/complementarias': ['INFORMES.ASISTENCIA.COMPLEMENTARIAS' as Permission],
  '/dashboard/informes/asistencia/welcome-session': ['INFORMES.ASISTENCIA.WELCOME' as Permission],
  '/dashboard/informes/asistencia/x-pais': ['INFORMES.ASISTENCIA.XPAIS' as Permission],
  '/dashboard/informes/sesiones/calendario-sesiones-jumps': ['INFORMES.PROGRAMACION.SESIONES_JUMPS' as Permission],
  '/dashboard/informes/sesiones/calendario-training-clubs': ['INFORMES.PROGRAMACION.TRAINING_CLUBS' as Permission],
  '/dashboard/informes/sesiones/calendario-welcome':        ['INFORMES.PROGRAMACION.WELCOME' as Permission],
  '/dashboard/informes/advisors/sesiones': ['INFORMES.ADVISORS.SESIONES' as Permission],
  '/dashboard/informes/advisors/jumps': ['INFORMES.ADVISORS.JUMPS' as Permission],
  '/dashboard/informes/advisors/training': ['INFORMES.ADVISORS.TRAINING' as Permission],
  '/dashboard/informes/advisors/clubes': ['INFORMES.ADVISORS.CLUBES' as Permission],
  '/dashboard/informes/advisors/welcome':   ['INFORMES.ADVISORS.WELCOME' as Permission],
  '/dashboard/informes/advisors/essential': ['INFORMES.ADVISORS.ESSENTIAL' as Permission],
  '/dashboard/informes/advisors/resumen': ['INFORMES.ADVISORS.RESUMEN' as Permission],
  '/dashboard/informes/academica/horas-advisor': ['INFORMES.ACADEMICA.HORAS_ADVISOR' as Permission],
  '/dashboard/informes/academica/hold-vigencias': ['INFORMES.ACADEMICA.HOLD_VIGENCIAS' as Permission],
  '/dashboard/informes/academica/x-niveles': ['INFORMES.ACADEMICA.X_NIVELES' as Permission],
  '/dashboard/informes/academica/conciliacion-steps': ['INFORMES.ACADEMICA.CONCILIACION_STEPS' as Permission],
  '/dashboard/informes/academica/por-vencer': ['INFORMES.ACADEMICA.POR_VENCER' as Permission],
  '/dashboard/informes/usuarios': ['INFORMES.USUARIOS' as Permission],
  '/dashboard/informes/infoacademic-user': ['INFORMES.ACADEMICA.INFOACADEMIC' as Permission],
  '/dashboard/informes/contratos': ['INFORMES.CONTRATOS' as Permission],
  '/dashboard/informes/contratos/matriculas': ['INFORMES.CONTRATOS.MATRICULAS' as Permission],
  '/dashboard/informes/planta/advisors': ['INFORMES.PLANTA.ADVISORS' as Permission],
  '/dashboard/informes/planta/administrativos': ['INFORMES.PLANTA.ADMINISTRATIVOS' as Permission],
  '/dashboard/informes/estadisticas':          ['INFORMES.ESTADISTICAS.NIVELES' as Permission],
  '/dashboard/informes/estadisticas/horarios': ['INFORMES.ESTADISTICAS.HORARIOS' as Permission],

  // Mantenimiento - Migrar Contrato
  '/admin/migrar-contrato': [
    'MANTENIMIENTO.CONTRATOS.MIGRAR' as Permission,
  ],
  '/admin/bloqueo-contrato': [
    'MANTENIMIENTO.CONTRATOS.BLOQUEAR' as Permission,
  ],
  '/admin/clear-historic': [
    'MANTENIMIENTO.USUARIOS.CLEAR_HISTORIC' as Permission,
  ],
  '/admin/edicion-contrato': [
    'MANTENIMIENTO.USUARIOS.EDICION_CONTRATO' as Permission,
  ],
  '/admin/generar-contrato': [
    'MANTENIMIENTO.USUARIOS.GENERAR_CONTRATO' as Permission,
  ],
  '/admin/contratos-prueba': [
    'MANTENIMIENTO.USUARIOS.CONTRATOS_PRUEBA' as Permission,
  ],
  '/admin/envio-mensajes': [
    'MANTENIMIENTO.USUARIOS.ENVIO_MENSAJES' as Permission,
  ],
  '/admin/roles/create': [
    'MANTENIMIENTO.USUARIOS.CREAR_ROL' as Permission,
  ],
  '/admin/ticker': [
    'MANTENIMIENTO.AVISOS.TICKER' as Permission,
  ],
  '/admin/banner': [
    'MANTENIMIENTO.AVISOS.BANNER' as Permission,
  ],
  '/admin/actualizar-videos': [
    'MANTENIMIENTO.MATERIAL.ACTUALIZAR_VIDEOS' as Permission,
  ],
  '/admin/plantillas/gestion': [
    'MANTENIMIENTO.PLANTILLAS.GESTION' as Permission,
  ],
  '/admin/scripts/usuarios-pegados': [
    'MANTENIMIENTO.SCRIPTS.USUARIOS_PEGADOS' as Permission,
  ],
  '/admin/scripts/consulta': [
    'MANTENIMIENTO.SCRIPTS.CONSULTA' as Permission,
  ],

  // Recaudos - Gestión
  '/dashboard/recaudos/gestion': [
    'RECAUDOS.GESTION.VER' as Permission,
  ],
  '/dashboard/recaudos/asignacion': [
    'RECAUDOS.ASIGNACION.VER' as Permission,
  ],

  // Aprobación
  '/dashboard/aprobacion': [
    'APROBACION.MODIFICAR.ACTUALIZAR' as Permission,
    'APROBACION.MODIFICAR.EXPORTAR_CSV' as Permission,
    'APROBACION.MODIFICAR.CONTRATO' as Permission,
    'APROBACION.MODIFICAR.ENVIAR_PDF' as Permission,
    'APROBACION.MODIFICAR.DESCARGAR' as Permission,
    'APROBACION.MODIFICAR.APROBACION_AUTONOMA' as Permission,
  ],
};

/**
 * Rutas genéricas que tienen acceso basado en permisos amplios
 */
export const GENERIC_ROUTE_ACCESS: Record<string, Permission[]> = {
  '/dashboard/academic': [
    // Cualquier permiso ACADEMICO.* da acceso a la sección
    'ACADEMICO.AGENDA.VER_CALENDARIO' as Permission,
    'ACADEMICO.AGENDA.VER_AGENDA' as Permission,
    'ACADEMICO.AGENDA.CALENDARIO_VER' as Permission,
    'ACADEMICO.AGENDA.LISTA_VER' as Permission,
    'ACADEMICO.AGENDA.FILTRO' as Permission,
    'ACADEMICO.AGENDA.NUEVO_EVENTO' as Permission,
    'ACADEMICO.AGENDA.EXPORTAR_CSV' as Permission,
    'ACADEMICO.AGENDA.EDITAR' as Permission,
    'ACADEMICO.AGENDA.ELIMINAR' as Permission,
    'ACADEMICO.AGENDA.CREAR_EVENTO' as Permission,
    'ACADEMICO.AGENDA.VER_AGENDA_ACADEMICA' as Permission,
    'ACADEMICO.ACADEMICA.VER' as Permission,
    'ACADEMICO.ACADEMICA.AGENDAMIENTO' as Permission,
    'ACADEMICO.ACADEMICA.EXPORTAR_CSV' as Permission,
    'ACADEMICO.ACADEMICA.ESTADISTICAS' as Permission,
    'ACADEMICO.ACADEMICA.EXPORTAR_STATS_CSV' as Permission,
    'ACADEMICO.ADVISOR.LISTA_VER' as Permission,
    'ACADEMICO.ADVISOR.VER_ENLACE' as Permission,
    'ACADEMICO.ADVISOR.AGREGAR' as Permission,
    'ACADEMICO.ADVISOR.ESTADISTICA' as Permission,
    'ACADEMICO.MATERIAL.ACTUALIZAR' as Permission,
  ],

  '/dashboard/servicio': [
    // Cualquier permiso SERVICIO.* da acceso a la sección
    'SERVICIO.WELCOME.CARGAR_EVENTOS' as Permission,
    'SERVICIO.WELCOME.EXPORTAR_CSV' as Permission,
    'SERVICIO.SESIONES.CARGAR_EVENTOS' as Permission,
    'SERVICIO.SESIONES.EXPORTAR_CSV' as Permission,
    'SERVICIO.USUARIOS.ACTUALIZAR' as Permission,
    'SERVICIO.USUARIOS.EXPORTAR_CSV' as Permission,
    'SERVICIO.EXAM_INTERN.IELTS_VER' as Permission,
    'SERVICIO.EXAM_INTERN.B2F_VER' as Permission,
    'SERVICIO.EXAM_INTERN.TOEFL_VER' as Permission,
  ],

  '/dashboard/comercial': [
    // Cualquier permiso COMERCIAL.* da acceso a la sección
    'COMERCIAL.CONTRATO.MODIFICAR' as Permission,
    'COMERCIAL.CONTRATO.ENVIAR_PDF' as Permission,
    'COMERCIAL.CONTRATO.DESCARGAR' as Permission,
    'COMERCIAL.CONTRATO.APROBACION_AUTONOMA' as Permission,
    'COMERCIAL.PROSPECTOS.VER' as Permission,
  ],

  '/dashboard/informes': [
    // Cualquier permiso INFORMES.* da acceso a la sección
    'INFORMES.VER' as Permission,
    'INFORMES.BENEFICIARIOS' as Permission,
    'INFORMES.EXPORTAR' as Permission,
    'INFORMES.ASISTENCIA' as Permission,
    'INFORMES.PROGRAMACION' as Permission,
    'INFORMES.ADVISORS' as Permission,
    'INFORMES.USUARIOS' as Permission,
    'INFORMES.CONTRATOS' as Permission,
    'INFORMES.PLANTA' as Permission,
    'INFORMES.ESTADISTICAS' as Permission,
  ],
};

/**
 * Verifica si un usuario tiene permiso para acceder a una ruta
 */
export function hasAccessToRoute(
  pathname: string,
  userPermissions: Permission[]
): boolean {
  // 1. Verificar si hay permisos específicos para esta ruta exacta
  const specificPerms = ROUTE_PERMISSIONS[pathname];
  if (specificPerms) {
    const hasAccess = specificPerms.some(perm => userPermissions.includes(perm));
    console.log(`  🔍 Ruta específica ${pathname}: ${hasAccess ? '✅' : '❌'} (requiere alguno de ${specificPerms.length} permisos)`);
    return hasAccess;
  }

  // 2. Verificar rutas genéricas (padre de la ruta)
  for (const [routePrefix, requiredPerms] of Object.entries(GENERIC_ROUTE_ACCESS)) {
    if (pathname.startsWith(routePrefix)) {
      const hasAccess = requiredPerms.some(perm => userPermissions.includes(perm));
      console.log(`  🔍 Ruta genérica ${routePrefix}: ${hasAccess ? '✅' : '❌'}`);
      return hasAccess;
    }
  }

  // 3. Rutas sin restricciones de permisos específicos
  console.log(`  ℹ️ Ruta ${pathname} no tiene permisos específicos definidos - PERMITIDO por defecto`);
  return true;
}

/**
 * Invalida el cache de permisos (útil para testing)
 */
export function invalidatePermissionsCache(role?: Role) {
  if (role) {
    permissionsCache.delete(role);
    console.log(`🗑️ [Middleware] Cache invalidado para rol ${role}`);
  } else {
    permissionsCache.clear();
    console.log(`🗑️ [Middleware] Cache completo invalidado`);
  }
}
