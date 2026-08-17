'use client'

import { useMemo, useState } from 'react'

/**
 * Modal de "el salón ya no tiene cupo" al dejar un contrato listo.
 *
 * Sale cuando el servidor rechaza la confirmación (409 `detail.tipo='sin_cupo'`)
 * SIN haber escrito nada. Ofrece las dos únicas salidas:
 *   - cambiar al beneficiario a un horario que sí tenga lugar (el desplegable ya
 *     viene filtrado por el servidor: no se ofrece un destino que se rechazaría), o
 *   - autorizar el sobrecupo, que exige permiso aparte.
 *
 * Las dos vuelven al mismo endpoint, así que el cupo se comprueba otra vez en el
 * último momento: entre que se abre este modal y se decide, otro comercial pudo
 * haberse llevado el asiento — o haberlo liberado.
 */

export interface AlternativaCupo {
  campaign: string
  tipoCurso: string
  horarioCurso: string
  salon: string | null
  cupos: number
  ocupados: number
  libres: number
}

export interface BenefSinCupo {
  personId: string
  nombre: string
  numeroId: string | null
  campaign: string | null
  tipoCurso: string | null
  horarioCurso: string | null
  salon: string | null
  cupos: number
  ocupados: number
  alternativas: AlternativaCupo[]
}

export interface SinCupoDetalle {
  tipo: 'sin_cupo'
  titularId: string
  beneficiarios: BenefSinCupo[]
}

interface Props {
  detalle: SinCupoDetalle
  contrato?: string | null
  titular?: string | null
  saving: boolean
  puedeSobrecupo: boolean
  onCancel: () => void
  onCambiarHorario: (cambios: { personId: string; campaign: string; tipoCurso: string; horarioCurso: string }[]) => void
  onSobrecupo: () => void
}

const claveAlt = (a: AlternativaCupo) => `${a.campaign}|${a.tipoCurso}|${a.horarioCurso}`

export default function SinCupoModal({
  detalle, contrato, titular, saving, puedeSobrecupo, onCancel, onCambiarHorario, onSobrecupo,
}: Props) {
  const [modo, setModo] = useState<'elegir' | 'horario' | 'sobrecupo'>('elegir')
  // personId → clave de la alternativa elegida
  const [sel, setSel] = useState<Record<string, string>>({})

  const benefs = detalle.beneficiarios || []
  const haySalida = benefs.some(b => b.alternativas.length > 0)
  const listo = useMemo(() => benefs.every(b => !!sel[b.personId]), [benefs, sel])

  const confirmarHorarios = () => {
    const cambios = benefs.map(b => {
      const [campaign, tipoCurso, horarioCurso] = String(sel[b.personId]).split('|')
      return { personId: b.personId, campaign, tipoCurso, horarioCurso }
    })
    onCambiarHorario(cambios)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6 max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900">
          {benefs.length === 1 ? 'El salón ya no tiene cupo' : `${benefs.length} beneficiarios sin cupo`}
        </h3>
        <p className="mt-1 text-sm text-gray-600">
          Contrato <strong>{contrato || '—'}</strong>{titular ? <> de <strong>{titular}</strong></> : null}.
          {' '}El cupo se toma al dejar el contrato listo, y el salón se llenó antes.
          <strong> Todavía no se guardó nada.</strong>
        </p>

        <div className="mt-4 space-y-3">
          {benefs.map(b => (
            <div key={b.personId} className="border border-amber-200 bg-amber-50 rounded-xl p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <b className="text-sm text-gray-900">{b.nombre}</b>
                <span className="text-xs text-gray-600">
                  {b.tipoCurso} · {b.horarioCurso}{b.salon ? ` · Salón ${b.salon}` : ''}
                  {' '}<span className="font-semibold text-amber-800">{b.ocupados}/{b.cupos}</span>
                </span>
              </div>

              {modo === 'horario' && (
                <div className="mt-2">
                  {b.alternativas.length === 0 ? (
                    <p className="text-xs text-red-700">
                      No hay ningún otro horario de {b.tipoCurso} con cupo en esta campaña.
                      Hay que ampliar el salón desde Académico › Campañas.
                    </p>
                  ) : (
                    <select
                      value={sel[b.personId] || ''}
                      onChange={e => setSel(s => ({ ...s, [b.personId]: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                      aria-label={`Nuevo horario para ${b.nombre}`}
                    >
                      <option value="">Elegir horario con cupo…</option>
                      {b.alternativas.map(a => (
                        <option key={claveAlt(a)} value={claveAlt(a)}>
                          {a.horarioCurso}{a.salon ? ` · Salón ${a.salon}` : ''} — {a.cupos === 0 ? 'sin límite' : `${a.libres} libre(s)`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {modo === 'sobrecupo' && (
          <div className="mt-4 border border-red-200 bg-red-50 rounded-xl p-3">
            <p className="text-sm text-red-800">
              Vas a meter {benefs.length === 1 ? 'a este beneficiario' : `a estos ${benefs.length} beneficiarios`} en
              un salón que ya está lleno. Quedará registrado quién lo autorizó y cuándo.
            </p>
            <p className="mt-2 text-xs text-red-700">
              Se volverá a comprobar el cupo: si mientras tanto se liberó un asiento, se toma ese y no queda como sobrecupo.
            </p>
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50">
            Cancelar
          </button>

          {modo === 'elegir' && (
            <>
              {haySalida && (
                <button onClick={() => setModo('horario')}
                  className="px-4 py-2 rounded-lg bg-purple-700 text-white text-sm font-medium hover:bg-purple-800">
                  Cambiar de horario
                </button>
              )}
              {puedeSobrecupo && (
                <button onClick={() => setModo('sobrecupo')}
                  className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700">
                  Autorizar sobrecupo
                </button>
              )}
              {!haySalida && !puedeSobrecupo && (
                <span className="text-xs text-gray-500 self-center">
                  Sin horarios con cupo. Amplía el salón desde Académico › Campañas.
                </span>
              )}
            </>
          )}

          {modo === 'horario' && (
            <>
              <button onClick={() => { setModo('elegir'); setSel({}) }}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50">
                Atrás
              </button>
              <button onClick={confirmarHorarios} disabled={!listo || saving}
                className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                {saving ? 'Guardando…' : 'Cambiar y dejar listo'}
              </button>
            </>
          )}

          {modo === 'sobrecupo' && (
            <>
              <button onClick={() => setModo('elegir')}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50">
                Atrás
              </button>
              <button onClick={onSobrecupo} disabled={saving}
                className="px-5 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                {saving ? 'Guardando…' : 'Confirmar sobrecupo'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
