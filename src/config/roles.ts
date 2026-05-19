/**
 * Matriz de Roles y Permisos - LGS Admin Panel
 * Define los permisos asignados a cada rol del sistema
 */

import {
  Role,
  Permission,
  RolePermissions,
  PersonPermission,
  StudentPermission,
  AcademicoPermission,
  InformesPermission,
  ServicioPermission,
  ComercialPermission,
  AprobacionPermission,
  MantenimientoPermission,
  RecaudosPermission,
} from '@/types/permissions';

// ============================================================================
// MATRIZ DE ROLES Y PERMISOS
// ============================================================================

/**
 * SUPER_ADMIN - Acceso total al sistema
 */
const SUPER_ADMIN_PERMISSIONS: Permission[] = [
  ...Object.values(PersonPermission),
  ...Object.values(StudentPermission),
  ...Object.values(AcademicoPermission),
  ...Object.values(InformesPermission),
  ...Object.values(ServicioPermission),
  ...Object.values(ComercialPermission),
  ...Object.values(AprobacionPermission),
  ...Object.values(MantenimientoPermission),
  ...Object.values(RecaudosPermission),
];

/**
 * ADMIN - Administrador con permisos amplios pero sin acciones destructivas críticas
 */
const ADMIN_PERMISSIONS: Permission[] = [
  // PERSON - Sin ELIMINAR
  PersonPermission.DESCARGAR_CONTRATO,
  PersonPermission.VER_DOCUMENTACION,
  PersonPermission.ADICION_DOCUMENTACION,
  PersonPermission.ACTIVAR_DESACTIVAR,
  PersonPermission.CAMBIO_CELULAR,
  PersonPermission.CAMBIAR_ESTADO,
  PersonPermission.APROBAR,
  PersonPermission.MODIFICAR,
  PersonPermission.AGREGAR_BENEFICIARIO,
  PersonPermission.WHATSAPP,

  // STUDENT - Todos
  ...Object.values(StudentPermission),

  // ACADEMICO - Todos
  ...Object.values(AcademicoPermission),

  // SERVICIO - Todos
  ...Object.values(ServicioPermission),

  // COMERCIAL - Todos
  ...Object.values(ComercialPermission),

  // APROBACION - Todos
  ...Object.values(AprobacionPermission),
];

/**
 * ADVISOR - Profesor/Advisor con permisos académicos
 */
const ADVISOR_PERMISSIONS: Permission[] = [
  // PERSON - Sin acceso (bloqueado completamente)
  // PersonPermission.VER_DOCUMENTACION,
  // PersonPermission.WHATSAPP,

  // STUDENT - Permisos académicos
  StudentPermission.ENVIAR_MENSAJE,
  StudentPermission.TABLA_FILTROS,
  StudentPermission.TABLA_DESCARGAR,
  StudentPermission.EVALUACION,
  StudentPermission.ANOTACION_ADVISOR,
  StudentPermission.COMENTARIOS_ESTUDIANTE,
  StudentPermission.AGENDAR_CLASE,
  StudentPermission.MARCAR_STEP,
  StudentPermission.CONSULTA,

  // ACADEMICO - Acceso completo a agenda
  AcademicoPermission.CALENDARIO_VER,
  AcademicoPermission.LISTA_VER,
  AcademicoPermission.FILTRO,
  AcademicoPermission.NUEVO_EVENTO,
  AcademicoPermission.EXPORTAR_CSV,
  AcademicoPermission.EDITAR,
  AcademicoPermission.CREAR_EVENTO,
  AcademicoPermission.VER,
  AcademicoPermission.ESTADISTICAS,
  AcademicoPermission.VER_ENLACE,

  // SERVICIO - Solo Welcome Session
  ServicioPermission.WELCOME_CARGAR_EVENTOS,
  ServicioPermission.WELCOME_EXPORTAR_CSV,
];

/**
 * COMERCIAL - Área comercial con permisos de ventas y contratos
 */
const COMERCIAL_PERMISSIONS: Permission[] = [
  // PERSON - Permisos básicos
  PersonPermission.DESCARGAR_CONTRATO,
  PersonPermission.VER_DOCUMENTACION,
  PersonPermission.ADICION_DOCUMENTACION,
  PersonPermission.CAMBIAR_ESTADO,
  PersonPermission.MODIFICAR,
  PersonPermission.AGREGAR_BENEFICIARIO,
  PersonPermission.WHATSAPP,

  // STUDENT - Solo consulta
  StudentPermission.ENVIAR_MENSAJE,
  StudentPermission.CONSULTA,
  StudentPermission.GENERAR_ESTADO,

  // COMERCIAL - Todos
  ...Object.values(ComercialPermission),

  // SERVICIO - Solo prospectos
  ServicioPermission.USUARIOS_ACTUALIZAR,
  ServicioPermission.USUARIOS_EXPORTAR_CSV,
];

/**
 * APROBADOR - Rol de aprobación de contratos
 */
const APROBADOR_PERMISSIONS: Permission[] = [
  // PERSON - Solo lectura y aprobación
  PersonPermission.DESCARGAR_CONTRATO,
  PersonPermission.VER_DOCUMENTACION,
  PersonPermission.APROBAR,

  // STUDENT - Solo consulta
  StudentPermission.CONSULTA,
  StudentPermission.GENERAR_ESTADO,

  // APROBACION - Todos
  ...Object.values(AprobacionPermission),

  // COMERCIAL - Solo lectura
  ComercialPermission.DESCARGAR,
  ComercialPermission.VER_PROSPECTOS,
];

/**
 * TALERO - Administrativo con permisos específicos (basado en imagen de ejemplo)
 */
const TALERO_PERMISSIONS: Permission[] = [
  // PERSON - Permisos administrativos
  PersonPermission.DESCARGAR_CONTRATO,
  PersonPermission.VER_DOCUMENTACION,
  PersonPermission.ADICION_DOCUMENTACION,
  PersonPermission.ACTIVAR_DESACTIVAR,
  PersonPermission.CAMBIO_CELULAR,
  PersonPermission.CAMBIAR_ESTADO,
  PersonPermission.APROBAR,
  PersonPermission.MODIFICAR,
  PersonPermission.AGREGAR_BENEFICIARIO,
  PersonPermission.WHATSAPP,

  // STUDENT - Permisos amplios
  StudentPermission.ENVIAR_MENSAJE,
  StudentPermission.TABLA_FILTROS,
  StudentPermission.TABLA_DESCARGAR,
  StudentPermission.CONSULTA,
  StudentPermission.ACTIVAR_HOLD,
  StudentPermission.EXTENDER_VIGENCIA,

  // ACADEMICO - Solo lectura
  AcademicoPermission.CALENDARIO_VER,
  AcademicoPermission.LISTA_VER,
  AcademicoPermission.FILTRO,
  AcademicoPermission.EXPORTAR_CSV,

  // SERVICIO - Todos
  ...Object.values(ServicioPermission),
];

/**
 * FINANCIERO - Área financiera con permisos de pagos
 */
const FINANCIERO_PERMISSIONS: Permission[] = [
  // PERSON - Solo lectura básica
  PersonPermission.DESCARGAR_CONTRATO,
  PersonPermission.VER_DOCUMENTACION,
  PersonPermission.WHATSAPP,

  // STUDENT - Permisos financieros
  StudentPermission.ENVIAR_MENSAJE,
  StudentPermission.CONSULTA,
  StudentPermission.GENERAR_ESTADO,
  StudentPermission.REGISTRAR_PAGO,
  StudentPermission.ENVIO_RECORDATORIO,

  // COMERCIAL - Solo consulta de contratos
  ComercialPermission.DESCARGAR,
  ComercialPermission.VER_PROSPECTOS,

  // APROBACION - Solo consulta
  AprobacionPermission.ACTUALIZAR,
  AprobacionPermission.EXPORTAR_CSV,
  AprobacionPermission.DESCARGAR,
];

/**
 * SERVICIO - Área de servicio al cliente
 */
const SERVICIO_PERMISSIONS: Permission[] = [
  // PERSON - Permisos básicos
  PersonPermission.VER_DOCUMENTACION,
  PersonPermission.ADICION_DOCUMENTACION,
  PersonPermission.WHATSAPP,

  // STUDENT - Permisos de servicio
  StudentPermission.ENVIAR_MENSAJE,
  StudentPermission.TABLA_FILTROS,
  StudentPermission.TABLA_DESCARGAR,
  StudentPermission.COMENTARIOS_ESTUDIANTE,
  StudentPermission.CONSULTA,

  // ACADEMICO - Solo lectura
  AcademicoPermission.CALENDARIO_VER,
  AcademicoPermission.LISTA_VER,
  AcademicoPermission.FILTRO,

  // SERVICIO - Todos
  ...Object.values(ServicioPermission),
];

/**
 * READONLY - Solo lectura (para reportes y consultas)
 */
const READONLY_PERMISSIONS: Permission[] = [
  // PERSON - Solo lectura
  PersonPermission.DESCARGAR_CONTRATO,
  PersonPermission.VER_DOCUMENTACION,

  // STUDENT - Solo consulta
  StudentPermission.TABLA_FILTROS,
  StudentPermission.TABLA_DESCARGAR,
  StudentPermission.CONSULTA,
  StudentPermission.GENERAR_ESTADO,

  // ACADEMICO - Solo lectura
  AcademicoPermission.CALENDARIO_VER,
  AcademicoPermission.LISTA_VER,
  AcademicoPermission.FILTRO,
  AcademicoPermission.EXPORTAR_CSV,
  AcademicoPermission.ESTADISTICAS,
  AcademicoPermission.EXPORTAR_STATS_CSV,

  // SERVICIO - Solo exportar
  ServicioPermission.WELCOME_EXPORTAR_CSV,
  ServicioPermission.SESIONES_EXPORTAR_CSV,
  ServicioPermission.USUARIOS_EXPORTAR_CSV,
];

/**
 * COORDINADOR_ACADEMICO - Coordinación académica con permisos ampliados
 * Sincronizado con Wix (35 permisos en Wix, 35 en código TypeScript)
 * Total: 3 PERSON + 11 STUDENT + 16 ACADEMICO + 5 SERVICIO = 35 permisos
 */
const COORDINADOR_ACADEMICO_PERMISSIONS: Permission[] = [
  // PERSON - Acceso básico (3 permisos)
  PersonPermission.VER_DOCUMENTACION,
  PersonPermission.CAMBIO_CELULAR,
  PersonPermission.WHATSAPP,

  // STUDENT - Gestión académica completa (11 permisos)
  StudentPermission.ENVIAR_MENSAJE,
  StudentPermission.TABLA_FILTROS,
  StudentPermission.TABLA_DESCARGAR,
  StudentPermission.EVALUACION,
  StudentPermission.ANOTACION_ADVISOR,
  StudentPermission.COMENTARIOS_ESTUDIANTE,
  StudentPermission.ELIMINAR_EVENTO,
  StudentPermission.AGENDAR_CLASE,
  StudentPermission.MARCAR_STEP,
  StudentPermission.ASIGNAR_STEP,
  StudentPermission.CONSULTA,

  // ACADEMICO - Gestión completa (16 permisos)
  AcademicoPermission.CALENDARIO_VER,
  AcademicoPermission.LISTA_VER,
  AcademicoPermission.FILTRO,
  AcademicoPermission.NUEVO_EVENTO,
  AcademicoPermission.EXPORTAR_CSV,
  AcademicoPermission.EDITAR,
  AcademicoPermission.CREAR_EVENTO,
  AcademicoPermission.VER,
  AcademicoPermission.AGENDAMIENTO,
  AcademicoPermission.ACADEMICA_EXPORTAR_CSV,
  AcademicoPermission.ESTADISTICAS,
  AcademicoPermission.EXPORTAR_STATS_CSV,
  AcademicoPermission.LISTA_ADVISORS_VER,
  AcademicoPermission.ADVISOR_VER_ENLACE,
  AcademicoPermission.AGREGAR,
  AcademicoPermission.ESTADISTICA,

  // SERVICIO - Gestión de sesiones (5 permisos)
  ServicioPermission.WELCOME_CARGAR_EVENTOS,
  ServicioPermission.SESIONES_CARGAR_EVENTOS,
  ServicioPermission.SESIONES_EXPORTAR_CSV,
  ServicioPermission.USUARIOS_ACTUALIZAR,
  ServicioPermission.USUARIOS_EXPORTAR_CSV,
];

// ============================================================================
// EXPORTACIÓN DE MATRIZ DE ROLES
// ============================================================================

export const ROLE_PERMISSIONS_MATRIX: RolePermissions[] = [
  { role: Role.SUPER_ADMIN, permissions: SUPER_ADMIN_PERMISSIONS },
  { role: Role.ADMIN, permissions: ADMIN_PERMISSIONS },
  { role: Role.ADVISOR, permissions: ADVISOR_PERMISSIONS },
  { role: Role.COMERCIAL, permissions: COMERCIAL_PERMISSIONS },
  { role: Role.APROBADOR, permissions: APROBADOR_PERMISSIONS },
  { role: Role.TALERO, permissions: TALERO_PERMISSIONS },
  { role: Role.FINANCIERO, permissions: FINANCIERO_PERMISSIONS },
  { role: Role.SERVICIO, permissions: SERVICIO_PERMISSIONS },
  { role: Role.READONLY, permissions: READONLY_PERMISSIONS },
  { role: Role.COORDINADOR_ACADEMICO, permissions: COORDINADOR_ACADEMICO_PERMISSIONS },
];

// ============================================================================
// FUNCIONES AUXILIARES
// ============================================================================

// Cache en memoria para permisos consultados desde Wix
const permissionsCache = new Map<Role, Permission[]>();
const cacheTimestamps = new Map<Role, number>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/**
 * Permisos hardcodeados como fallback si Wix no está disponible
 */
const FALLBACK_PERMISSIONS_MAP: Record<string, Permission[]> = {
  SUPER_ADMIN: SUPER_ADMIN_PERMISSIONS,
  admin: SUPER_ADMIN_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
  ADVISOR: ADVISOR_PERMISSIONS,
  COMERCIAL: COMERCIAL_PERMISSIONS,
  APROBADOR: APROBADOR_PERMISSIONS,
  TALERO: TALERO_PERMISSIONS,
  FINANCIERO: FINANCIERO_PERMISSIONS,
  SERVICIO: SERVICIO_PERMISSIONS,
  READONLY: READONLY_PERMISSIONS,
  COORDINADOR_ACADEMICO: COORDINADOR_ACADEMICO_PERMISSIONS,
};

/**
 * Invalida el cache de permisos para un rol específico o todos los roles
 */
export function invalidatePermissionsCache(role?: Role): void {
  if (role) {
    permissionsCache.delete(role);
    cacheTimestamps.delete(role);
    console.log(`🗑️ Cache invalidado para ${role}`);
  } else {
    permissionsCache.clear();
    cacheTimestamps.clear();
    console.log(`🗑️ Cache completo de permisos invalidado`);
  }
}

/**
 * Obtiene los permisos de un rol específico
 * NUEVA VERSIÓN: Consulta Wix con cache de 5 minutos
 */
export async function getPermissionsByRole(role: Role): Promise<Permission[]> {
  // 1. Verificar cache en memoria
  const cachedPerms = permissionsCache.get(role);
  const cacheTime = cacheTimestamps.get(role);

  if (cachedPerms && cacheTime && Date.now() - cacheTime < CACHE_TTL) {
    const age = Math.floor((Date.now() - cacheTime) / 1000);
    console.log(`✅ Permisos de ${role} desde cache (${age}s de antigüedad)`);
    return cachedPerms;
  }

  // 2. Intentar consultar Wix
  try {
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3001';
    const response = await fetch(
      `${baseUrl}/api/postgres/roles?rol=${role}`,
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(3000) // Timeout 3 segundos
      }
    );

    if (response.ok) {
      const data = await response.json();

      if (data.success && data.permisos && Array.isArray(data.permisos)) {
        // Actualizar cache
        permissionsCache.set(role, data.permisos);
        cacheTimestamps.set(role, Date.now());

        console.log(`✅ Permisos de ${role} desde Wix (${data.permisos.length} permisos)`);
        return data.permisos;
      }
    }

    // Si no hay datos válidos, lanzar error para ir a fallback
    throw new Error('No se pudieron cargar permisos desde Wix');

  } catch (error) {
    console.error(`❌ Error cargando permisos de ${role} desde Wix:`, error);

    // 3. FALLBACK: Usar permisos hardcodeados
    console.warn(`⚠️ Usando permisos FALLBACK para ${role}`);
    const fallbackPerms = FALLBACK_PERMISSIONS_MAP[role] || [];

    // Cachear fallback también (para no hacer requests repetidos si Wix está caído)
    permissionsCache.set(role, fallbackPerms);
    cacheTimestamps.set(role, Date.now());

    return fallbackPerms;
  }
}

/**
 * Obtiene los permisos de un rol específico (VERSIÓN SÍNCRONA - LEGACY)
 * @deprecated Usa getPermissionsByRole() que consulta Wix
 */
export function getPermissionsByRoleSync(role: Role): Permission[] {
  const rolePermissions = ROLE_PERMISSIONS_MATRIX.find((rp) => rp.role === role);
  return rolePermissions?.permissions || [];
}

/**
 * Verifica si un rol tiene un permiso específico
 */
export function roleHasPermission(role: Role, permission: Permission): boolean {
  const permissions = getPermissionsByRole(role);
  return permissions.includes(permission);
}

/**
 * Obtiene todos los roles disponibles
 */
export function getAllRoles(): Role[] {
  return Object.values(Role);
}

/**
 * Cuenta cuántos permisos tiene un rol
 */
export function countRolePermissions(role: Role): number {
  return getPermissionsByRole(role).length;
}
