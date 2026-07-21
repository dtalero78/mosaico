'use client'

import { useRouter } from 'next/navigation'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { MantenimientoPermission } from '@/types/permissions'
import {
  AcademicCapIcon,
  BriefcaseIcon,
  UserGroupIcon,
  BuildingOffice2Icon,
  ArrowTopRightOnSquareIcon,
  TableCellsIcon,
} from '@heroicons/react/24/outline'

/**
 * Crear Usuarios — hub con 4 opciones:
 *   1. Estudiante   → login desde un beneficiario existente (rol ESTUDIANTE)
 *   2. Administrativo → cuenta de staff (rol seleccionable, clave auto)
 *   3. Advisor      → reusa el flujo /nuevo-guia (GUIAS + USUARIOS_ROLES)
 *   4. Comercial    → EQUIPO_COMERCIAL + login (rol COMERCIAL/COMERCIAL_JEFE)
 * Reemplaza al antiguo "Crea UserRol". Gateado por MANTENIMIENTO.USUARIOS.CREAR_ROL.
 */
export default function CrearUsuariosHub() {
  const router = useRouter()
  const go = (path: string) => router.push(path)
  const openTab = (path: string) => window.open(path, '_blank', 'noopener,noreferrer')

  // Clases completas por acento (Tailwind JIT no detecta strings dinámicos).
  const ACCENTS: Record<string, { hover: string; iconBg: string; iconText: string }> = {
    blue:    { hover: 'hover:border-blue-500',    iconBg: 'bg-blue-50',    iconText: 'text-blue-600' },
    indigo:  { hover: 'hover:border-indigo-500',  iconBg: 'bg-indigo-50',  iconText: 'text-indigo-600' },
    green:   { hover: 'hover:border-green-500',   iconBg: 'bg-green-50',   iconText: 'text-green-600' },
    fuchsia: { hover: 'hover:border-fuchsia-500', iconBg: 'bg-fuchsia-50', iconText: 'text-fuchsia-600' },
    amber:   { hover: 'hover:border-amber-500',   iconBg: 'bg-amber-50',   iconText: 'text-amber-600' },
  }

  const Card = ({
    onClick, disabled, accent, icon, title, desc, badge,
  }: {
    onClick: () => void; disabled?: boolean; accent: string
    icon: React.ReactNode; title: string; desc: string; badge?: string
  }) => (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`flex flex-col items-start gap-3 p-6 bg-white border-2 border-gray-200 rounded-2xl shadow-sm text-left transition-all group ${
        disabled ? 'opacity-50 cursor-not-allowed' : `${ACCENTS[accent].hover} hover:shadow-md`
      }`}
    >
      <div className={`w-12 h-12 ${ACCENTS[accent].iconBg} rounded-xl flex items-center justify-center ${ACCENTS[accent].iconText}`}>
        {icon}
      </div>
      <div>
        <div className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          {title}
          {badge && <span className="text-[10px] font-medium bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{badge}</span>}
        </div>
        <div className="text-sm text-gray-500 mt-1">{desc}</div>
      </div>
    </button>
  )

  return (
    <DashboardLayout>
      <PermissionGuard permission={MantenimientoPermission.CREAR_ROL} showDefaultMessage>
        <div className="p-6 max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Crear Usuarios</h1>
          <p className="text-gray-500 mb-8">Selecciona qué tipo de usuario deseas crear.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <Card
              accent="blue"
              icon={<AcademicCapIcon className="w-6 h-6" />}
              title="Estudiante"
              desc="Crea el login de un beneficiario ya vinculado a un contrato (rol ESTUDIANTE)."
              onClick={() => go('/admin/roles/create/estudiante')}
            />
            <Card
              accent="indigo"
              icon={<BriefcaseIcon className="w-6 h-6" />}
              title="Administrativo"
              desc="Cuenta de staff: selecciona el rol y se genera la clave automáticamente."
              onClick={() => go('/admin/roles/create/administrativo')}
            />
            <Card
              accent="green"
              icon={<UserGroupIcon className="w-6 h-6" />}
              title="Advisor / Guía"
              desc="Crea un guía (GUIAS + login). Abre el formulario de alta de guía."
              onClick={() => openTab('/nuevo-guia')}
            />
            <Card
              accent="fuchsia"
              icon={<BuildingOffice2Icon className="w-6 h-6" />}
              title="Comercial"
              desc="Crea una persona del equipo comercial (EQUIPO_COMERCIAL + login por correo)."
              onClick={() => go('/admin/roles/create/comercial')}
            />
            <Card
              accent="amber"
              icon={<TableCellsIcon className="w-6 h-6" />}
              title="Consultar usuarios"
              desc="Consulta cuentas de login por rol: email, nombre, ID, usuario y clave. Exporta a CSV."
              onClick={() => go('/admin/roles/create/consultar')}
            />
          </div>

          <div className="mt-8 flex items-center gap-2 text-sm">
            <ArrowTopRightOnSquareIcon className="w-4 h-4 text-gray-400" />
            <button type="button" onClick={() => go('/admin/roles/create/filiales')}
              className="text-fuchsia-600 hover:text-fuchsia-800 font-medium">
              Gestionar filiales (para el alta de comerciales)
            </button>
          </div>
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
