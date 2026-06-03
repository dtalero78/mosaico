'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import {
  HomeIcon,
  AcademicCapIcon,
  SpeakerWaveIcon,
  UsersIcon,
  ShieldCheckIcon,
  KeyIcon,
  Bars3Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  ArrowRightOnRectangleIcon,
  PuzzlePieceIcon,
  MegaphoneIcon,
  ChartBarIcon,
  WrenchScrewdriverIcon,
  BanknotesIcon,
} from '@heroicons/react/24/outline'
import { cn } from '@/lib/utils'
import SearchBar from '@/components/search/SearchBar'
import { usePermissions } from '@/hooks/usePermissions'
import { ServicioPermission, AcademicoPermission, InformesPermission, ComercialPermission, AprobacionPermission, MantenimientoPermission, RecaudosPermission, Permission } from '@/types/permissions'

const getNavigation = (userEmail: string) => [
  {
    name: 'Dashboard',
    href: '/',
    icon: HomeIcon
  },
  {
    name: 'Académico',
    icon: AcademicCapIcon,
    children: [
      { name: 'Agenda Sesiones', href: '/dashboard/academic/agenda-sesiones' },
      { name: 'Agenda Académica', href: '/dashboard/academic/agenda-academica' },
      { name: 'Advisors', href: '/dashboard/academic/advisors' },
      { name: 'Panel Advisor', href: `/panel-advisor?email=${encodeURIComponent(userEmail)}` },
      { name: 'Actualizar Material', href: '/dashboard/academic/actualizar-material', newTab: true },
      { name: 'Control Horas', href: '/dashboard/academic/control-horas' },
      { name: 'Evaluaciones Jump', href: '/dashboard/academic/jump-evaluaciones' },
      { name: 'Performance Evaluation', href: '/dashboard/academic/performance-evaluation', newTab: true },
    ],
  },
  {
    name: 'Servicio',
    icon: SpeakerWaveIcon,
    children: [
      { name: 'Welcome Session', href: '/dashboard/servicio/welcome-session' },
      { name: 'Lista de Sesiones', href: '/dashboard/servicio/lista-sesiones' },
      { name: 'Usuarios sin perfil creado', href: '/dashboard/servicio/sin-registro' },
      {
        name: 'Exam. Intern.', isSubmenu: true, children: [
          { name: 'IELTS',    href: '/dashboard/servicio/exam-intern/ielts',    newTab: true },
          { name: 'B2 First', href: '/dashboard/servicio/exam-intern/b2first', newTab: true },
          { name: 'TOEFL',    href: '/dashboard/servicio/exam-intern/toefl',    newTab: true },
        ],
      },
    ],
  },
  {
    name: 'Comercial',
    icon: UsersIcon,
    children: [
      { name: 'Crear Contrato', href: '/dashboard/comercial/crear-contrato' },
      { name: 'Subir Lote', href: '/subir-lote', superAdminOnly: true },
    ],
  },
  {
    name: 'Aprobación',
    href: '/dashboard/aprobacion',
    icon: ShieldCheckIcon,
  },
  {
    name: 'Recaudos',
    icon: BanknotesIcon,
    children: [
      { name: 'Gestión',    href: '/dashboard/recaudos/gestion',    newTab: true },
      { name: 'Asignación', href: '/dashboard/recaudos/asignacion', newTab: true },
    ],
  },
  {
    name: 'Informes',
    icon: ChartBarIcon,
    children: [
      {
        name: 'Asistencia', isSubmenu: true, children: [
          { name: 'Sesiones', href: '/dashboard/informes/asistencia/sesiones-clubes', newTab: true },
          { name: 'Clubes', href: '/dashboard/informes/asistencia/clubes', newTab: true },
          { name: 'Actividades Complementarias', href: '/dashboard/informes/asistencia/complementarias', newTab: true },
          { name: 'Welcome Session', href: '/dashboard/informes/asistencia/welcome-session', newTab: true },
          { name: 'X País', href: '/dashboard/informes/asistencia/x-pais', newTab: true },
        ]
      },
      {
        name: 'Programación', isSubmenu: true, children: [
          { name: 'Sesiones - Jumps',  href: '/dashboard/informes/sesiones/calendario-sesiones-jumps', newTab: true },
          { name: 'Training - Clubs',  href: '/dashboard/informes/sesiones/calendario-training-clubs', newTab: true },
          { name: 'Welcome',           href: '/dashboard/informes/sesiones/calendario-welcome',        newTab: true },
        ]
      },
      {
        name: 'Advisors', isSubmenu: true, children: [
          { name: 'Sesiones', href: '/dashboard/informes/advisors/sesiones', newTab: true },
          { name: 'Jumps', href: '/dashboard/informes/advisors/jumps', newTab: true },
          { name: 'Training', href: '/dashboard/informes/advisors/training', newTab: true },
          { name: 'Clubes', href: '/dashboard/informes/advisors/clubes', newTab: true },
          { name: 'Welcome',   href: '/dashboard/informes/advisors/welcome',    newTab: true },
          { name: 'Essential', href: '/dashboard/informes/advisors/essential',  newTab: true },
          { name: 'Resumen',   href: '/dashboard/informes/advisors/resumen',    newTab: true },
        ]
      },
      {
        name: 'Académica', isSubmenu: true, children: [
          { name: 'Horas Advisor', href: '/dashboard/informes/academica/horas-advisor', newTab: true },
          { name: 'Hold & Vigencias', href: '/dashboard/informes/academica/hold-vigencias', newTab: true },
          { name: 'Conciliación Steps', href: '/dashboard/informes/academica/conciliacion-steps', newTab: true },
          { name: 'Por Vencer', href: '/dashboard/informes/academica/por-vencer', newTab: true },
          { name: 'X Niveles', href: '/dashboard/informes/academica/x-niveles', newTab: true },
          { name: 'Usuarios', href: '/dashboard/informes/usuarios', newTab: true },
          { name: 'InfoAcademic User', href: '/dashboard/informes/infoacademic-user', newTab: true },
        ]
      },
      {
        name: 'Contratos', isSubmenu: true, children: [
          { name: 'Matrículas', href: '/dashboard/informes/contratos/matriculas', newTab: true },
        ]
      },
      {
        name: 'Planta', isSubmenu: true, children: [
          { name: 'Advisors', href: '/dashboard/informes/planta/advisors', newTab: true },
          { name: 'Administrativos', href: '/dashboard/informes/planta/administrativos', newTab: true },
        ]
      },
      {
        name: 'Estadísticas', isSubmenu: true, children: [
          { name: 'Niveles',  href: '/dashboard/informes/estadisticas',         newTab: true },
          { name: 'Horarios', href: '/dashboard/informes/estadisticas/horarios', newTab: true },
        ]
      },
      // Nota: las áreas Administración/Gerencia/Servicio/Recaudo/Comercial/Sistema
      // ya no son "tableros" en construcción; reaparecerán como secciones aquí
      // cuando tengan su primer informe (igual que Académica).
    ],
  },
  {
    name: 'Mantenimiento',
    icon: WrenchScrewdriverIcon,
    superAdminOnly: true,
    children: [
      { name: 'Permisos', href: '/admin/permissions' },
      {
        name: 'Avisos',
        isSubmenu: true,
        children: [
          { name: 'Ticker', href: '/admin/ticker' },
          { name: 'Banner', href: '/admin/banner' },
        ],
      },
      {
        name: 'Juegos',
        isSubmenu: true,
        children: [
          { name: 'Architecture Quiz', href: '/game.html', external: true },
          { name: 'Pac-Man Data Flow', href: '/game-pacman.html', external: true },
        ],
      },
      {
        name: 'Material', isSubmenu: true, children: [
          { name: 'Actualizar Videos', href: '/admin/actualizar-videos', newTab: true },
        ],
      },
      {
        name: 'Usuarios', isSubmenu: true, children: [
          { name: 'Bloqueo Contrato', href: '/admin/bloqueo-contrato', newTab: true },
          { name: 'Clear Historic',   href: '/admin/clear-historic',   newTab: true },
          { name: 'Contratos Prueba', href: '/admin/contratos-prueba', newTab: true },
          { name: 'Edición Contrato', href: '/admin/edicion-contrato', newTab: true },
          { name: 'Generar Contrato', href: '/admin/generar-contrato', newTab: true },
          { name: 'Migrar Contrato',  href: '/admin/migrar-contrato',  newTab: true },
          { name: 'Envío Mensajes',   href: '/admin/envio-mensajes',   newTab: true },
          { name: 'Crea UserRol',     href: '/admin/roles/create',     newTab: true },
        ],
      },
      {
        name: 'Scripts', isSubmenu: true, children: [
          { name: 'Usuarios Pegados', href: '/admin/scripts/usuarios-pegados', newTab: true },
          { name: 'Consulta', href: '/admin/scripts/consulta', newTab: true },
        ],
      },
    ],
  },
]

interface DashboardLayoutProps {
  children: React.ReactNode
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [expandedSections, setExpandedSections] = useState<string[]>([])
  const pathname = usePathname()
  const { data: session } = useSession()
  const { userPermissions, hasAnyPermission, isLoading, permissionsSource, isRole } = usePermissions()

  // Get user role and email from session
  const userRole = (session?.user as any)?.role || 'READONLY'
  const userEmail = session?.user?.email || ''

  // Verificar si el usuario es admin o tiene acceso total
  const hasFullAccess = isRole('SUPER_ADMIN') || isRole('ADMIN') || userRole === 'admin'

  // Mapeo de permisos para cada sub-página específica
  const pagePermissions: Record<string, Permission[]> = {
    // Académico
    '/dashboard/academic/agenda-sesiones': [
      AcademicoPermission.VER_CALENDARIO,
      AcademicoPermission.VER_AGENDA,
      AcademicoPermission.CALENDARIO_VER,
      AcademicoPermission.LISTA_VER,
      AcademicoPermission.FILTRO,
      AcademicoPermission.NUEVO_EVENTO,
      AcademicoPermission.EXPORTAR_CSV,
      AcademicoPermission.EDITAR,
      AcademicoPermission.ELIMINAR,
      AcademicoPermission.CREAR_EVENTO,
    ],
    '/dashboard/academic/agenda-academica': [
      AcademicoPermission.VER_AGENDA_ACADEMICA,
      AcademicoPermission.VER,
      AcademicoPermission.AGENDAMIENTO,
      AcademicoPermission.ACADEMICA_EXPORTAR_CSV,
      AcademicoPermission.ESTADISTICAS,
      AcademicoPermission.EXPORTAR_STATS_CSV,
    ],
    '/dashboard/academic/advisors': [
      AcademicoPermission.LISTA_ADVISORS_VER, // ← TALERO tiene este
      AcademicoPermission.AGREGAR,
      AcademicoPermission.ESTADISTICA,
    ],
    '/dashboard/academic/actualizar-material': [
      AcademicoPermission.ACTUALIZAR_MATERIAL,
    ],
    '/dashboard/academic/control-horas': [
      AcademicoPermission.CONTROL_HORAS_VER,
    ],
    '/dashboard/academic/jump-evaluaciones': [
      AcademicoPermission.JUMP_EVAL_REVISAR,
    ],
    '/dashboard/academic/performance-evaluation': [
      AcademicoPermission.PERFORMANCE_EVAL_VER,
    ],
    '/panel-advisor': [
      AcademicoPermission.ADVISOR_VER_ENLACE,
    ],
    // Nivel 3 — cada reporte con su permiso específico (nieto)
    '/dashboard/informes/asistencia/sesiones-clubes': [InformesPermission.ASIS_SESIONES],
    '/dashboard/informes/asistencia/clubes': [InformesPermission.ASIS_CLUBES],
    '/dashboard/informes/asistencia/complementarias': [InformesPermission.ASIS_COMPLEMENTARIAS],
    '/dashboard/informes/asistencia/welcome-session': [InformesPermission.ASIS_WELCOME],
    '/dashboard/informes/asistencia/x-pais': [InformesPermission.ASIS_XPAIS],
    '/dashboard/informes/sesiones/calendario-sesiones-jumps': [InformesPermission.PROG_SESIONES_JUMPS],
    '/dashboard/informes/sesiones/calendario-training-clubs': [InformesPermission.PROG_TRAINING_CLUBS],
    '/dashboard/informes/sesiones/calendario-welcome':        [InformesPermission.PROG_WELCOME],
    '/dashboard/informes/advisors/sesiones': [InformesPermission.ADV_SESIONES],
    '/dashboard/informes/advisors/jumps': [InformesPermission.ADV_JUMPS],
    '/dashboard/informes/advisors/training': [InformesPermission.ADV_TRAINING],
    '/dashboard/informes/advisors/clubes': [InformesPermission.ADV_CLUBES],
    '/dashboard/informes/advisors/welcome':   [InformesPermission.ADV_WELCOME],
    '/dashboard/informes/advisors/essential': [InformesPermission.ADV_ESSENTIAL],
    '/dashboard/informes/advisors/resumen':   [InformesPermission.ADV_RESUMEN],
    '/dashboard/informes/academica/horas-advisor': [InformesPermission.ACAD_HORAS_ADVISOR],
    '/dashboard/informes/academica/hold-vigencias': [InformesPermission.ACAD_HOLD_VIGENCIAS],
    '/dashboard/informes/academica/x-niveles': [InformesPermission.ACAD_X_NIVELES],
    '/dashboard/informes/academica/conciliacion-steps': [InformesPermission.ACAD_CONCILIACION_STEPS],
    '/dashboard/informes/academica/por-vencer': [InformesPermission.ACAD_POR_VENCER],
    '/dashboard/informes/usuarios':           [InformesPermission.USUARIOS],
    '/dashboard/informes/infoacademic-user':  [InformesPermission.ACAD_INFOACADEMIC],
    '/dashboard/informes/contratos':          [InformesPermission.CONTRATOS],
    '/dashboard/informes/contratos/matriculas': [InformesPermission.CONTRATOS_MATRICULAS],
    '/dashboard/informes/planta/advisors': [InformesPermission.PLANTA_ADVISORS],
    '/dashboard/informes/planta/administrativos': [InformesPermission.PLANTA_ADMINISTRATIVOS],
    '/dashboard/informes/estadisticas':         [InformesPermission.EST_NIVELES],
    '/dashboard/informes/estadisticas/horarios': [InformesPermission.EST_HORARIOS],

    // Servicio
    '/dashboard/servicio/welcome-session': [
      ServicioPermission.WELCOME_CARGAR_EVENTOS,
      ServicioPermission.WELCOME_EXPORTAR_CSV,
    ],
    '/dashboard/servicio/lista-sesiones': [
      ServicioPermission.SESIONES_CARGAR_EVENTOS,
      ServicioPermission.SESIONES_EXPORTAR_CSV,
    ],
    '/dashboard/servicio/sin-registro': [
      ServicioPermission.USUARIOS_ACTUALIZAR,
      ServicioPermission.USUARIOS_EXPORTAR_CSV,
    ],
    '/dashboard/servicio/exam-intern/ielts':   [ServicioPermission.EXAM_INTERN_IELTS_VER],
    '/dashboard/servicio/exam-intern/b2first': [ServicioPermission.EXAM_INTERN_B2F_VER],
    '/dashboard/servicio/exam-intern/toefl':   [ServicioPermission.EXAM_INTERN_TOEFL_VER],

    // Comercial
    '/dashboard/comercial/crear-contrato': [
      ComercialPermission.MODIFICAR_CONTRATO,
      ComercialPermission.ENVIAR_PDF,
      ComercialPermission.DESCARGAR,
      ComercialPermission.APROBACION_AUTONOMA,
    ],
    '/subir-lote': [
      ComercialPermission.MODIFICAR_CONTRATO,
    ],
    '/admin/migrar-contrato': [
      MantenimientoPermission.MIGRAR_CONTRATO,
    ],
    '/admin/bloqueo-contrato': [
      MantenimientoPermission.BLOQUEAR_CONTRATO,
    ],
    '/admin/clear-historic': [
      MantenimientoPermission.CLEAR_HISTORIC,
    ],
    '/admin/edicion-contrato': [
      MantenimientoPermission.EDICION_CONTRATO,
    ],
    '/admin/generar-contrato': [
      MantenimientoPermission.GENERAR_CONTRATO,
    ],
    '/admin/contratos-prueba': [
      MantenimientoPermission.CONTRATOS_PRUEBA,
    ],
    '/admin/envio-mensajes': [
      MantenimientoPermission.ENVIO_MENSAJES,
    ],
    '/admin/roles/create': [
      MantenimientoPermission.CREAR_ROL,
    ],
    '/admin/ticker': [
      MantenimientoPermission.AVISOS_TICKER,
    ],
    '/admin/banner': [
      MantenimientoPermission.AVISOS_BANNER,
    ],
    '/admin/actualizar-videos': [
      MantenimientoPermission.ACTUALIZAR_VIDEOS,
    ],
    '/admin/scripts/usuarios-pegados': [
      MantenimientoPermission.SCRIPTS_USUARIOS_PEGADOS,
    ],
    '/admin/scripts/consulta': [
      MantenimientoPermission.SCRIPTS_CONSULTA,
    ],
    // Recaudos
    '/dashboard/recaudos/gestion': [
      RecaudosPermission.GESTION_VER,
    ],
    '/dashboard/recaudos/asignacion': [
      RecaudosPermission.ASIGNACION_VER,
    ],
    // Aprobación
    '/dashboard/aprobacion': [
      AprobacionPermission.ACTUALIZAR,
      AprobacionPermission.EXPORTAR_CSV,
      AprobacionPermission.VER_CONTRATO,
      AprobacionPermission.ENVIAR_PDF,
      AprobacionPermission.DESCARGAR,
      AprobacionPermission.APROBACION_AUTONOMA,
    ],
  }

  // Mapeo de secciones del menú a los permisos requeridos (si el usuario tiene CUALQUIERA de estos permisos, ve la sección)
  const sectionPermissions: Record<string, Permission[]> = {
    'Académico': [
      // Todos los permisos de ACADEMICO.AGENDA.*
      AcademicoPermission.VER_CALENDARIO,
      AcademicoPermission.VER_AGENDA,
      AcademicoPermission.CALENDARIO_VER,
      AcademicoPermission.LISTA_VER,
      AcademicoPermission.FILTRO,
      AcademicoPermission.NUEVO_EVENTO,
      AcademicoPermission.EXPORTAR_CSV,
      AcademicoPermission.EDITAR,
      AcademicoPermission.ELIMINAR,
      AcademicoPermission.CREAR_EVENTO,
      AcademicoPermission.VER_AGENDA_ACADEMICA,
      // ACADEMICO.ACADEMICA.*
      AcademicoPermission.VER,
      AcademicoPermission.AGENDAMIENTO,
      AcademicoPermission.ACADEMICA_EXPORTAR_CSV,
      AcademicoPermission.ESTADISTICAS,
      AcademicoPermission.EXPORTAR_STATS_CSV,
      // ACADEMICO.ADVISOR.*
      AcademicoPermission.LISTA_ADVISORS_VER,
      AcademicoPermission.ADVISOR_VER_ENLACE,
      AcademicoPermission.AGREGAR,
      AcademicoPermission.ESTADISTICA,
      // ACADEMICO.MATERIAL.*
      AcademicoPermission.ACTUALIZAR_MATERIAL,
    ],
    // El grupo Informes se muestra si el usuario tiene CUALQUIER permiso de
    // Informes (el abuelo VER, un ítem de informe o un botón). Las secciones
    // (Asistencia, etc.) aparecen solas según los ítems permitidos (2 marcas).
    'Informes': Object.values(InformesPermission),
    'Servicio': [
      // SERVICIO.WELCOME.*
      ServicioPermission.WELCOME_CARGAR_EVENTOS,
      ServicioPermission.WELCOME_EXPORTAR_CSV,
      // SERVICIO.SESIONES.*
      ServicioPermission.SESIONES_CARGAR_EVENTOS,
      ServicioPermission.SESIONES_EXPORTAR_CSV,
      // SERVICIO.USUARIOS.*
      ServicioPermission.USUARIOS_ACTUALIZAR,
      ServicioPermission.USUARIOS_EXPORTAR_CSV,
    ],
    'Comercial': [
      // COMERCIAL.CONTRATO.*
      ComercialPermission.MODIFICAR_CONTRATO,
      ComercialPermission.ENVIAR_PDF,
      ComercialPermission.DESCARGAR,
      ComercialPermission.APROBACION_AUTONOMA,
      // COMERCIAL.PROSPECTOS.*
      ComercialPermission.VER_PROSPECTOS,
    ],
    'Aprobación': [
      // APROBACION.MODIFICAR.*
      AprobacionPermission.ACTUALIZAR,
      AprobacionPermission.EXPORTAR_CSV,
      AprobacionPermission.VER_CONTRATO,
      AprobacionPermission.ENVIAR_PDF,
      AprobacionPermission.DESCARGAR,
      AprobacionPermission.APROBACION_AUTONOMA,
    ],
    'Recaudos': [
      RecaudosPermission.GESTION_VER,
      RecaudosPermission.ASIGNACION_VER,
    ],
  }

  console.log('🔍 DashboardLayout permissions check:', {
    userRole,
    hasFullAccess,
    permissionsSource,
    permissionsCount: userPermissions.length,
  })

  // Get navigation with dynamic email
  const navigation = getNavigation(userEmail)

  const filteredNavigation = navigation.filter(item => {
    // Always show Dashboard home
    if (item.href === '/') return true

    // Items exclusivos de SUPER_ADMIN — pero Mantenimiento también se muestra
    // si el usuario tiene algún permiso de Mantenimiento (ej: MIGRAR_CONTRATO)
    if (item.superAdminOnly) {
      if (isRole('SUPER_ADMIN')) return true
      if (item.name === 'Mantenimiento') {
        return hasAnyPermission(Object.values(MantenimientoPermission) as Permission[])
      }
      return false
    }

    // Full access users see everything
    if (hasFullAccess) return true

    // Permisos page - only for admins
    if (item.href === '/admin/permissions') {
      return hasFullAccess
    }

    // Verificar si tiene permisos para esta sección
    if (item.name && sectionPermissions[item.name]) {
      const requiredPerms = sectionPermissions[item.name]
      const hasAccess = hasAnyPermission(requiredPerms)
      console.log(`  ${item.name}: ${hasAccess ? '✅' : '❌'}`)

      // Debug detallado para Académico si es TALERO
      if (item.name === 'Académico' && userRole === 'TALERO') {
        console.log('    🔍 DEBUG Académico para TALERO:')
        console.log('    User permissions:', userPermissions)
        console.log('    Required permissions:', requiredPerms)
        console.log('    Intersection:', userPermissions.filter(p => requiredPerms.includes(p)))
      }

      return hasAccess
    }

    // Si no hay mapeo de permisos, mostrar por defecto
    return true
  })

    // Also filter children of each navigation item based on page permissions
  const finalNavigation = filteredNavigation.map(item => {
    if (!item.children) return item

    // Paso 1 — Nivel 3 (nietos): para cada submenu, filtrar sus reportes
    // individuales por su permiso propio en pagePermissions. SUPER_ADMIN/ADMIN
    // (hasFullAccess) ven todos. Items sin permiso definido se muestran.
    const childrenLvl3 = item.children.map((child: any) => {
      if (child.isSubmenu && Array.isArray(child.children)) {
        if (hasFullAccess) return child
        const filteredGrand = child.children.filter((g: any) => {
          if (g.superAdminOnly && !isRole('SUPER_ADMIN')) return false
          const gPerms = pagePermissions[g.href]
          return gPerms ? hasAnyPermission(gPerms) : true
        })
        return { ...child, children: filteredGrand }
      }
      return child
    })

    // Paso 2 — Nivel 2 (hijos): filtrar children basándose en permisos
    const filteredChildren = childrenLvl3.filter((child: any) => {
      // Items restringidos a SUPER_ADMIN
      if (child.superAdminOnly && !isRole('SUPER_ADMIN')) return false

      // Full access users see everything (except superAdminOnly already filtered above)
      if (hasFullAccess) return true

      // Para Mantenimiento: no-SUPER_ADMIN solo ve ítems con permiso explícito en pagePermissions.
      // Permisos, Avisos, Juegos, Material → no tienen pagePermissions → se ocultan.
      // Usuarios (isSubmenu) tiene Migrar Contrato → tiene pagePermissions → visible si tiene permiso.
      if (item.name === 'Mantenimiento') {
        if (child.isSubmenu) {
          // Mostrar submenu Usuarios solo si alguno de sus hijos tiene permiso
          const hasChildPerm = (child.children || []).some((grandchild: any) => {
            const gPerms = pagePermissions[grandchild.href]
            return gPerms ? hasAnyPermission(gPerms) : false
          })
          return hasChildPerm
        }
        const mPerms = pagePermissions[child.href]
        return mPerms ? hasAnyPermission(mPerms) : false
      }

      // Sub-grupos de Informes (Asistencia, Programación, Advisors, Académica,
      // Planta, Estadísticas): modelo de 2 marcas — la sección se muestra si le
      // queda ≥1 ítem visible tras el filtrado de nivel 3 (no necesita permiso
      // propio de sección). Basta marcar el abuelo "Informes" + el ítem.
      if (child.isSubmenu && item.name === 'Informes') {
        return (child.children?.length ?? 0) > 0
      }

      const requiredPerms = pagePermissions[child.href]
      if (!requiredPerms) return true // Si no hay permisos definidos, mostrar por defecto

      const hasAccess = hasAnyPermission(requiredPerms)

      // Debug para TALERO
      if (userRole === 'TALERO') {
        console.log(`    📄 ${child.name} (${child.href}): ${hasAccess ? '✅' : '❌'}`)
      }

      return hasAccess
    })

    return {
      ...item,
      children: filteredChildren,
    }
  })

  const toggleSection = (sectionName: string) => {
    setExpandedSections(prev =>
      prev.includes(sectionName)
        ? prev.filter(name => name !== sectionName)
        : [...prev, sectionName]
    )
  }

  const isCurrentPath = (href: string) => {
    if (!pathname) return false
    if (href === '/') {
      return pathname === '/'
    }
    return pathname.startsWith(href)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar */}
      <div className={cn(
        "fixed inset-0 z-50 lg:hidden",
        sidebarOpen ? "block" : "hidden"
      )}>
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75" onClick={() => setSidebarOpen(false)} />
        <div className="fixed inset-y-0 left-0 flex w-64 flex-col bg-white">
          <SidebarContent
            navigation={finalNavigation}
            expandedSections={expandedSections}
            toggleSection={toggleSection}
            isCurrentPath={isCurrentPath}
            onLinkClick={() => setSidebarOpen(false)}
          />
        </div>
      </div>

      {/* Desktop sidebar */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col">
        <SidebarContent
          navigation={finalNavigation}
          expandedSections={expandedSections}
          toggleSection={toggleSection}
          isCurrentPath={isCurrentPath}
        />
      </div>

      {/* Main content */}
      <div className="lg:pl-64 flex flex-col flex-1">
        {/* Top header with search and profile */}
        <div className="bg-white border-b border-gray-200 shadow-sm">
          <div className="px-4 sm:px-6 lg:px-8">
            <div className="flex h-16 items-center gap-4">
              {/* Mobile menu button */}
              <button
                type="button"
                className="lg:hidden p-2 text-gray-700 hover:bg-gray-100 rounded-md"
                onClick={() => setSidebarOpen(true)}
              >
                <Bars3Icon className="h-6 w-6" />
              </button>

              {/* Search bar container */}
              <div className="flex-1 max-w-2xl">
                {userRole !== 'COMERCIAL' && <SearchBar />}
              </div>

            </div>
          </div>
        </div>

        {/* Page content */}
        <main className="py-10">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>

        {/* User profile - bottom right */}
        <div className="fixed bottom-4 right-4 z-50 pointer-events-auto">
          <div className="flex items-center gap-x-2 bg-white rounded-lg shadow-lg border border-gray-200 px-3 py-2">
            <div className="h-6 w-6 rounded-full bg-primary-600 flex items-center justify-center">
              <span className="text-xs font-medium text-white">
                {session?.user?.name?.charAt(0).toUpperCase() || 'U'}
              </span>
            </div>
            <span className="text-sm font-medium text-gray-900">
              {session?.user?.name || 'User'}
            </span>
            <button
              onClick={async () => {
                try {
                  console.log('🚪 Starting NUCLEAR logout...')

                  // 1. Limpiar TODO el almacenamiento
                  localStorage.clear()
                  sessionStorage.clear()
                  console.log('✅ Storage cleared')

                  // 2. Eliminar TODAS las cookies del dominio
                  document.cookie.split(';').forEach(cookie => {
                    const name = cookie.split('=')[0].trim()
                    // Eliminar con diferentes configuraciones
                    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`
                    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${window.location.hostname};`
                    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.${window.location.hostname};`
                    console.log(`🗑️ Deleted cookie: ${name}`)
                  })

                  // 3. Llamar a nuestro endpoint personalizado
                  await fetch('/api/auth/logout', {
                    method: 'POST',
                  })

                  // 4. Llamar al signOut de NextAuth
                  await signOut({
                    redirect: false,
                  })

                  // 5. Esperar un momento
                  await new Promise(resolve => setTimeout(resolve, 300))

                  // 6. FORZAR navegación al login SIN HISTORIAL
                  console.log('↪️ Force redirecting to /login')
                  window.location.replace('/login')
                } catch (error) {
                  console.error('❌ Logout error:', error)
                  window.location.replace('/login')
                }
              }}
              className="ml-2 p-1 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
              title="Cerrar sesión"
            >
              <ArrowRightOnRectangleIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface SidebarContentProps {
  navigation: any[]
  expandedSections: string[]
  toggleSection: (name: string) => void
  isCurrentPath: (href: string) => boolean
  onLinkClick?: () => void
}

function SidebarContent({
  navigation,
  expandedSections,
  toggleSection,
  isCurrentPath,
  onLinkClick
}: SidebarContentProps) {
  return (
    <div className="flex grow flex-col gap-y-5 overflow-y-auto border-r border-gray-200 bg-white px-6 pb-4">
      {/* Logo */}
      <div className="flex h-16 shrink-0 items-center">
        <div className="h-8 w-8 rounded bg-primary-600 flex items-center justify-center">
          <span className="text-white font-bold">LGS</span>
        </div>
        <span className="ml-2 text-xl font-bold text-gray-900">Admin Panel</span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col">
        <ul role="list" className="flex flex-1 flex-col gap-y-7">
          <li>
            <ul role="list" className="-mx-2 space-y-1">
              {navigation.map((item) => (
                <li key={item.href ?? item.name}>
                  {item.children ? (
                    <div>
                      <button
                        onClick={() => toggleSection(item.name)}
                        className={cn(
                          "flex items-center w-full text-left px-2 py-2 text-sm font-medium rounded-md transition-colors duration-200",
                          "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                        )}
                      >
                        <item.icon className="h-6 w-6 shrink-0 mr-3" />
                        <span className="flex-1">{item.name}</span>
                        {expandedSections.includes(item.name) ? (
                          <ChevronDownIcon className="h-4 w-4" />
                        ) : (
                          <ChevronRightIcon className="h-4 w-4" />
                        )}
                      </button>
                      {expandedSections.includes(item.name) && (
                        <ul className="mt-2 space-y-1 pl-11">
                          {item.children.map((subItem: any) => (
                            <li key={subItem.name}>
                              {subItem.isSubmenu && subItem.children ? (
                                <div>
                                  <button
                                    onClick={() => toggleSection(`${item.name}-${subItem.name}`)}
                                    className="flex items-center w-full text-left px-2 py-2 text-sm rounded-md transition-colors duration-200 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                                  >
                                    <span className="flex-1">{subItem.name}</span>
                                    {expandedSections.includes(`${item.name}-${subItem.name}`) ? (
                                      <ChevronDownIcon className="h-3 w-3" />
                                    ) : (
                                      <ChevronRightIcon className="h-3 w-3" />
                                    )}
                                  </button>
                                  {expandedSections.includes(`${item.name}-${subItem.name}`) && (
                                    <ul className="mt-1 space-y-1 pl-4">
                                      {subItem.children.map((nestedItem: any) => (
                                        <li key={nestedItem.name}>
                                          <Link
                                            href={nestedItem.href}
                                            onClick={onLinkClick}
                                            target={nestedItem.newTab ? '_blank' : undefined}
                                            rel={nestedItem.newTab ? 'noopener noreferrer' : undefined}
                                            className={cn(
                                              "block px-2 py-2 text-sm rounded-md transition-colors duration-200",
                                              isCurrentPath(nestedItem.href)
                                                ? "bg-primary-100 text-primary-900 font-medium"
                                                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                                            )}
                                          >
                                            {nestedItem.name}
                                          </Link>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              ) : subItem.external ? (
                                <a
                                  href={subItem.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={onLinkClick}
                                  className="block px-2 py-2 text-sm rounded-md transition-colors duration-200 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                                >
                                  {subItem.name}
                                </a>
                              ) : (
                                <Link
                                  href={subItem.href}
                                  onClick={onLinkClick}
                                  target={subItem.newTab ? '_blank' : undefined}
                                  rel={subItem.newTab ? 'noopener noreferrer' : undefined}
                                  className={cn(
                                    "block px-2 py-2 text-sm rounded-md transition-colors duration-200",
                                    isCurrentPath(subItem.href)
                                      ? "bg-primary-100 text-primary-900 font-medium"
                                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                                  )}
                                >
                                  {subItem.name}
                                </Link>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <Link
                      href={item.href}
                      onClick={onLinkClick}
                      target={item.href === '/admin/permissions' ? '_blank' : undefined}
                      rel={item.href === '/admin/permissions' ? 'noopener noreferrer' : undefined}
                      className={cn(
                        "flex items-center px-2 py-2 text-sm font-medium rounded-md transition-colors duration-200",
                        isCurrentPath(item.href)
                          ? "bg-primary-100 text-primary-900"
                          : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                      )}
                    >
                      <item.icon className="h-6 w-6 shrink-0 mr-3" />
                      {item.name}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </li>
        </ul>
      </nav>
    </div>
  )
}