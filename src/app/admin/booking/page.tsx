'use client'

import { useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { MantenimientoPermission } from '@/types/permissions'
import { CalendarDaysIcon, MagnifyingGlassIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'

interface Lookup {
  persona: any
  curso: any
  eventos: { total: number; futuros: number; pasados: number }
  bookings: { total: number; futuros: number; pasados: number }
  faltan: { futuros: number; pasados: number }
  proxima: string | null
  problemas: string[]
  advertencias: string[]
  puedeGenerar: boolean
}

const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm font-medium text-gray-900">{children}</div>
    </div>
  )
}

export default function BookingPage() {
  const [numeroId, setNumeroId] = useState('')
  const [data, setData] = useState<Lookup | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [generando, setGenerando] = useState(false)
  const [hecho, setHecho] = useState<{ creados: number; total: number; futuros: number; proxima: string | null } | null>(null)

  const buscar = async () => {
    const id = numeroId.trim()
    if (!id) return
    setBuscando(true); setError(null); setData(null); setHecho(null)
    try {
      const r = await fetch(`/api/admin/booking/lookup?numeroId=${encodeURIComponent(id)}`, { cache: 'no-store' })
      const j = await r.json()
      if (!j.success) { setError(j.error || 'No se pudo consultar'); return }
      setData(j as Lookup)
    } catch (e: any) {
      setError(e?.message || 'Error de red')
    } finally { setBuscando(false) }
  }

  const generar = async () => {
    if (!data) return
    setGenerando(true); setError(null)
    try {
      const r = await fetch('/api/admin/booking/generar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peopleId: data.persona._id }),
      })
      const j = await r.json()
      if (!j.success) { setError(j.error || 'No se pudo generar'); return }
      setHecho({ creados: j.creados, total: j.total, futuros: j.futuros, proxima: j.proxima })
      setConfirmando(false)
      await buscar()   // refresca el estado para que se vea cómo quedó
    } catch (e: any) {
      setError(e?.message || 'Error de red')
    } finally { setGenerando(false) }
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={MantenimientoPermission.BOOKING} showDefaultMessage>
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center gap-3">
            <CalendarDaysIcon className="h-8 w-8 text-primary-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Booking</h1>
              <p className="text-sm text-gray-600">
                Genera los agendamientos que le falten a un usuario sobre las sesiones de su curso.
              </p>
            </div>
          </div>

          {/* Búsqueda */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <label htmlFor="numeroId" className="block text-sm font-medium text-gray-700 mb-1">
              Número de documento del usuario
            </label>
            <div className="flex gap-2">
              <input
                id="numeroId"
                value={numeroId}
                onChange={e => setNumeroId(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === 'Enter') buscar() }}
                placeholder="Ej. 252299025"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <button
                type="button" onClick={buscar} disabled={buscando || !numeroId.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
              >
                <MagnifyingGlassIcon className="h-4 w-4" />
                {buscando ? 'Buscando…' : 'Buscar'}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Se compara sin puntos ni guiones, así que da igual cómo esté escrito.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">{error}</div>
          )}

          {hecho && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-5">
              <div className="flex items-center gap-2 text-emerald-900 font-semibold">
                <CheckCircleIcon className="h-5 w-5" />
                {hecho.creados > 0 ? `${hecho.creados} agendamiento(s) creado(s)` : 'No hacía falta crear ninguno'}
              </div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Dato label="Total de clases">{hecho.total}</Dato>
                <Dato label="Pendientes por dictar">{hecho.futuros}</Dato>
                <Dato label="Próxima clase">{fecha(hecho.proxima)}</Dato>
              </div>
            </div>
          )}

          {/* Ficha */}
          {data && (
            <div className="bg-white rounded-lg shadow-sm p-6 space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{data.persona.nombre}</h2>
                <p className="text-sm text-gray-600">
                  {data.persona.numeroId} · Contrato {data.persona.contrato || '—'} ·{' '}
                  {data.persona.aprobacion || 'Sin aprobar'}
                  {data.persona.estadoInactivo ? ' · Inactivo' : ''}
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 rounded-lg bg-gray-50 p-4">
                <Dato label="Campaña">{data.persona.campaign || '—'}</Dato>
                <Dato label="Curso">{data.persona.tipoCurso || '—'}</Dato>
                <Dato label="Salón">{data.persona.salon || data.curso?.salon || '—'}</Dato>
                <Dato label="Horario">{data.persona.horarioCurso || '—'}</Dato>
                <Dato label="Guía">{data.curso?.guia || 'Sin asignar'}</Dato>
                <Dato label="Módulo · Lección">
                  {data.persona.nivel || '—'} · {data.persona.step || '—'}
                </Dato>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Dato label="Sesiones del curso">{data.eventos.total}</Dato>
                <Dato label="Ya agendadas">{data.bookings.total}</Dato>
                <Dato label="Faltan (futuras)">
                  <span className={data.faltan.futuros > 0 ? 'text-amber-700' : 'text-emerald-700'}>
                    {data.faltan.futuros}
                  </span>
                </Dato>
                <Dato label="Próxima clase">{fecha(data.proxima)}</Dato>
              </div>

              {data.faltan.pasados > 0 && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                  Hay <strong>{data.faltan.pasados}</strong> sesión(es) del curso que ya se dictaron y este usuario
                  no tenía agendadas. <strong>No se crean</strong>: lo dejarían marcado como ausente en clases
                  donde nunca estuvo inscrito.
                </div>
              )}

              {data.advertencias?.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                    <ExclamationTriangleIcon className="h-5 w-5" />
                    Ten en cuenta
                  </div>
                  <ul className="mt-2 space-y-1 text-sm text-amber-800 list-disc list-inside">
                    {data.advertencias.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}

              {data.problemas.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-red-900">
                    <ExclamationTriangleIcon className="h-5 w-5" />
                    No se puede generar
                  </div>
                  <ul className="mt-2 space-y-1 text-sm text-red-800 list-disc list-inside">
                    {data.problemas.map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                </div>
              )}

              <div className="flex justify-end">
                {data.puedeGenerar ? (
                  <button
                    type="button" onClick={() => setConfirmando(true)}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700"
                  >
                    Generar {data.faltan.futuros} agendamiento(s)
                  </button>
                ) : data.problemas.length === 0 ? (
                  <span className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg text-sm font-semibold">
                    <CheckCircleIcon className="h-4 w-4" />
                    No le falta ninguna clase
                  </span>
                ) : null}
              </div>
            </div>
          )}

          {/* Confirmación */}
          {confirmando && data && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
                <h3 className="text-lg font-semibold text-gray-900">Confirmar agendamiento</h3>
                <p className="text-sm text-gray-600 mt-2">
                  Se le van a crear <strong>{data.faltan.futuros}</strong> clase(s) a{' '}
                  <strong>{data.persona.nombre}</strong> sobre las sesiones pendientes de su curso.
                </p>

                <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-4">
                  <Dato label="Curso">{data.persona.tipoCurso}</Dato>
                  <Dato label="Salón">{data.persona.salon || data.curso?.salon || '—'}</Dato>
                  <Dato label="Horario">{data.persona.horarioCurso}</Dato>
                  <Dato label="Guía">{data.curso?.guia || 'Sin asignar'}</Dato>
                </div>

                <ul className="mt-4 space-y-1 text-sm text-gray-700 list-disc list-inside">
                  <li>Sólo se crean las sesiones <strong>que aún no se han dictado</strong>.</li>
                  <li>No se duplica ninguna: las que ya tiene se respetan.</li>
                  {data.faltan.pasados > 0 && (
                    <li>Las <strong>{data.faltan.pasados}</strong> sesión(es) ya dictadas quedan fuera.</li>
                  )}
                </ul>

                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button" onClick={() => setConfirmando(false)} disabled={generando}
                    className="px-4 py-2 text-sm rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button" onClick={generar} disabled={generando}
                    className="px-4 py-2 text-sm rounded-md text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
                  >
                    {generando ? 'Generando…' : 'Confirmar y generar'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
