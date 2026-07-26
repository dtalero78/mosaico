'use client'

import {
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  ArrowPathRoundedSquareIcon,
  MinusCircleIcon,
} from '@heroicons/react/24/outline'

interface ProgressReportProps {
  data: any
  isLoading: boolean
}

const fmtFecha = (iso: string | null) => {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })
  } catch { return '' }
}

function EstadoIcon({ estado }: { estado: string }) {
  if (estado === 'aprobada') return <CheckCircleIcon className="h-5 w-5 text-green-600" />
  if (estado === 'no_aprobada') return <ExclamationTriangleIcon className="h-5 w-5 text-amber-500" />
  if (estado === 'ausente') return <XCircleIcon className="h-5 w-5 text-red-500" />
  if (estado === 'programada') return <ClockIcon className="h-5 w-5 text-gray-400" />
  return <MinusCircleIcon className="h-5 w-5 text-gray-300" />
}

const bgEstado = (estado: string) =>
  estado === 'aprobada' ? 'bg-green-50'
  : estado === 'no_aprobada' ? 'bg-amber-50'
  : estado === 'ausente' ? 'bg-red-50'
  : 'bg-gray-50'

export default function ProgressReport({ data, isLoading }: ProgressReportProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-40 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 bg-gray-100 rounded-lg" />)}
        </div>
      </div>
    )
  }

  const report = data?.report
  if (!report) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <p className="text-gray-400 text-sm">No se pudo cargar el progreso</p>
      </div>
    )
  }

  const { resumen, modulos = [], nivelacion } = report
  const modActual = modulos.find((m: any) => m.esActual) || modulos.find((m: any) => !m.completo) || modulos[modulos.length - 1]
  const lecciones = modActual?.lecciones || []

  return (
    <div className="space-y-4">
      {/* Resumen del módulo actual */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Progreso — {resumen?.moduloActual || 'Módulo'}
          </h3>
          <span className="text-lg font-bold text-primary-600">{resumen?.porcentajeModulo || 0}%</span>
        </div>
        {resumen?.curso && (
          <p className="text-xs text-gray-400 mb-3">Curso {resumen.curso} · Módulo {resumen.modulosCompletos}/{resumen.totalModulos} completados</p>
        )}
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div className="bg-primary-600 h-3 rounded-full transition-all duration-500" style={{ width: `${resumen?.porcentajeModulo || 0}%` }} />
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500">
          <span>{resumen?.leccionesAprobadasModulo || 0} de {resumen?.totalLeccionesModulo || 0} lecciones</span>
          <span>{resumen?.porcentajeAsistencia || 0}% asistencia</span>
        </div>
        {modActual?.completo ? (
          <p className="mt-3 text-sm font-medium text-green-700 bg-green-50 rounded-lg px-3 py-2">
            🎉 Completaste las lecciones de este módulo.
          </p>
        ) : (resumen?.faltanModulo > 0) && (
          <p className="mt-3 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
            Te faltan <strong>{resumen.faltanModulo}</strong> {resumen.faltanModulo === 1 ? 'sesión' : 'sesiones'} para completar el módulo y avanzar.
          </p>
        )}
      </div>

      {/* Nivelación */}
      {nivelacion?.activa && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
          <div className="flex items-start gap-2">
            <ArrowPathRoundedSquareIcon className="h-5 w-5 text-orange-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-orange-800">Nivelación {nivelacion.aprobada ? 'realizada' : 'programada'}</p>
              <p className="text-xs text-orange-700 mt-0.5">
                {nivelacion.leccion ? `${nivelacion.modulo ? nivelacion.modulo + ' · ' : ''}${nivelacion.leccion}` : 'Refuerzo asignado por tu guía'}
                {!nivelacion.aprobada && ' — pendiente con tu guía.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Lecciones del módulo actual */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Lecciones de {modActual?.modulo || 'este módulo'}
        </h3>
        <div className="space-y-2">
          {lecciones.length === 0 && (
            <p className="text-sm text-gray-400">Aún no hay lecciones registradas para este módulo.</p>
          )}
          {lecciones.map((l: any) => (
            <div key={`${l.orden}-${l.leccion}`} className={`flex items-start gap-3 p-3 rounded-lg ${bgEstado(l.estado)}`}>
              <div className="flex-shrink-0 mt-0.5"><EstadoIcon estado={l.estado} /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-900">{l.leccion}</span>
                  {l.refuerzo && (
                    <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded">🔁 REFUERZO</span>
                  )}
                  {l.movimiento && (
                    <span className="text-[10px] font-bold text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded">↕️ Movimiento Académico</span>
                  )}
                  {l.estado === 'aprobada' && !l.movimiento && (
                    <span className="text-[10px] font-medium text-green-700">Asististe y aprobaste</span>
                  )}
                  {l.estado === 'programada' && l.fecha && (
                    <span className="text-[10px] text-gray-400">{fmtFecha(l.fecha)}</span>
                  )}
                </div>
                {l.mensaje && <p className="text-xs text-gray-500 mt-0.5">{l.mensaje}</p>}
              </div>
            </div>
          ))}

          {/* Evaluación del módulo */}
          {modActual?.evaluacion && (
            <div className={`flex items-start gap-3 p-3 rounded-lg border-2 ${bgEstado(modActual.evaluacion.estado)} ${modActual.evaluacion.estado === 'aprobada' ? 'border-green-200' : 'border-primary-200'}`}>
              <div className="flex-shrink-0 mt-0.5"><EstadoIcon estado={modActual.evaluacion.estado} /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900">🎓 Evaluación del módulo</span>
                  {modActual.evaluacion.estado === 'aprobada' && <span className="text-[10px] font-medium text-green-700">Aprobada por tu guía</span>}
                  {modActual.evaluacion.estado === 'programada' && modActual.evaluacion.fecha && <span className="text-[10px] text-gray-400">{fmtFecha(modActual.evaluacion.fecha)}</span>}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {modActual.evaluacion.mensaje
                    || (modActual.evaluacion.estado === 'aprobada' ? 'Completaste el módulo. ¡Puedes avanzar!'
                    : !modActual.leccionesOk ? 'Se habilita al completar las lecciones del módulo.'
                    : 'La presentas con tu guía en la sesión de evaluación.')}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
