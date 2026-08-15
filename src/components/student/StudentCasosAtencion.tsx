'use client'

import { WrenchScrewdriverIcon } from '@heroicons/react/24/outline'

/**
 * Pestaña "Casos Atención" de la ficha del estudiante.
 *
 * Placeholder: la pestaña existe para que el informe Servicio › Casos de Atención
 * pueda enlazar aquí desde el nombre del beneficiario
 * (`/student/[id]?tab=casos-atencion`). El contenido está por definir.
 */
export default function StudentCasosAtencion({ studentName }: { studentName?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
      <WrenchScrewdriverIcon className="h-10 w-10 mx-auto text-gray-300" />
      <h3 className="mt-3 text-lg font-semibold text-gray-900">Casos de Atención</h3>
      <p className="mt-1 text-sm text-gray-500">
        En construcción{studentName ? ` — ${studentName}` : ''}.
      </p>
      <p className="mt-3 text-xs text-gray-400 max-w-md mx-auto">
        Aquí se verán los casos de atención del estudiante. Por ahora se consultan
        desde Servicio › Casos de Atención.
      </p>
    </div>
  )
}
