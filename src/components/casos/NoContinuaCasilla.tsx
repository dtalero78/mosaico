'use client'

import { NO_CONTINUA_LABEL } from '@/lib/casos-atencion-estados'

/**
 * Casilla "Usuario NO continúa con el curso" de los diálogos de cierre de un Caso
 * de Atención (bandejas de Servicio y ficha del alumno). Destacada en rojo: es la
 * razón de cierre que más importa no pasar por alto. Sólo marca el caso — no
 * inactiva al alumno ni libera su cupo, y el texto lo dice para que nadie lo asuma.
 */
export default function NoContinuaCasilla({
  checked, onChange, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 mt-4 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
      checked ? 'bg-red-100 border-red-500' : 'bg-red-50 border-red-300 hover:border-red-400'}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 accent-red-600" />
      <span>
        <span className="block text-sm font-bold text-red-700 uppercase tracking-wide">{NO_CONTINUA_LABEL}</span>
        <span className="block text-xs text-red-700/80 mt-0.5">
          Queda marcado en el caso y en el Histórico. No inactiva al alumno ni libera su cupo.
        </span>
      </span>
    </label>
  )
}
