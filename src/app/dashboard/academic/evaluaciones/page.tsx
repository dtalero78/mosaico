'use client'

import CuestionariosReportPage from '@/components/academic/CuestionariosReportPage'
import { AcademicoPermission } from '@/types/permissions'

/**
 * Académico › Guías › Evaluaciones — resultados de los módulos "Evaluación NN".
 * Comparte pantalla con Entrenamientos (mismo componente, distinta categoría).
 */
export default function EvaluacionesPage() {
  return (
    <CuestionariosReportPage
      tipo="evaluacion"
      titulo="Evaluaciones"
      sustantivo="Evaluación"
      permiso={AcademicoPermission.EVALUACIONES_VER}
    />
  )
}
