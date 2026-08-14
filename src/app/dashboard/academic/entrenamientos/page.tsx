'use client'

import CuestionariosReportPage from '@/components/academic/CuestionariosReportPage'
import { AcademicoPermission } from '@/types/permissions'

/**
 * Académico › Guías › Entrenamientos — resultados de los módulos
 * "Entrenamiento NN". Misma operatividad que Evaluaciones (mismo componente y
 * mismos endpoints), sólo cambia la categoría consultada y el permiso.
 */
export default function EntrenamientosPage() {
  return (
    <CuestionariosReportPage
      tipo="entrenamiento"
      titulo="Entrenamientos"
      sustantivo="Entrenamiento"
      permiso={AcademicoPermission.ENTRENAMIENTOS_VER}
    />
  )
}
