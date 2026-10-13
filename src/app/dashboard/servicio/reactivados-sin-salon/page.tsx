'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import SalonDestinoSelector, { type SalonDestino } from '@/components/student/SalonDestinoSelector'
import { StudentPermission } from '@/types/permissions'
import { formatDateTime } from '@/lib/utils'
import { exportToExcel } from '@/lib/export-excel'
import { coincidePersona } from '@/lib/busqueda-persona'

interface Reactivado {
  peopleId: string
  academicaId: string
  primerNombre: string
  primerApellido: string
  numeroId: string
  contrato: string
  celular: string
  apoderado: string
  apoderadoTelefono: string
  finalContrato: string | null
  cursoAlPausar: string | null
  fechaOnHold: string | null
  fechaFinOnHold: string | null
  reactivadoEn: string | null
  modoReactivacion: string | null
}

const nombreDe = (r: Reactivado) => `${r.primerNombre || ''} ${r.primerApellido || ''}`.trim() || '(sin nombre)'
const modoTexto = (m: string | null) =>
  m === 'AUTOMATICO' ? 'Automática (venció la pausa)' : m === 'MANUAL' ? 'Manual' : 'Sin registro'

/**
 * Servicio › Reactivados sin salón.
 *
 * Al pausarse (OnHold) el alumno suelta su curso; cuando la pausa vence, el cron
 * lo reactiva pero no puede elegirle salón. Aquí se le asigna. La lista se
 * calcula en el servidor: al asignarle salón, sale sola.
 */
export default function ReactivadosSinSalonPage() {
  const [rows, setRows] = useState<Reactivado[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [buscar, setBuscar] = useState('')
  const [target, setTarget] = useState<Reactivado | null>(null)
  const [destino, setDestino] = useState<SalonDestino | null>(null)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/postgres/students/onhold/sin-salon', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data?.error || `Error ${res.status}`)
      setRows(data.rows || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const filtradas = useMemo(
    () => rows.filter(r => coincidePersona({ nombre: nombreDe(r), numeroId: r.numeroId, contrato: r.contrato }, buscar)),
    [rows, buscar])

  const asignar = async () => {
    if (!target || !destino) return
    setGuardando(true)
    try {
      const res = await fetch('/api/postgres/students/onhold/asignar-salon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ academicaId: target.academicaId, destino }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data?.error || `Error ${res.status}`)
      toast.success(`${nombreDe(target)}: ${data.message || 'salón asignado'}`)
      setTarget(null)
      await cargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo asignar el salón')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={StudentPermission.ACTIVAR_HOLD} showDefaultMessage>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">▶️ Reactivados sin salón</h1>
            <p className="text-sm text-gray-600 mt-1">
              Alumnos que salieron del OnHold sin curso: al pausarse soltaron su salón. Asígnales uno con cupo
              para que vuelvan a tener clases y aparezcan en la lista de su guía.
            </p>
          </div>

          <div className="card">
            <div className="card-content">
              <div className="mb-6 p-4 bg-gray-50 rounded-lg border flex flex-col md:flex-row gap-4 md:items-end">
                <div className="flex-1">
                  <label htmlFor="rssBuscar" className="block text-sm font-medium text-gray-700 mb-1">Nombre, ID o contrato</label>
                  <input
                    id="rssBuscar"
                    type="text"
                    value={buscar}
                    onChange={e => setBuscar(e.target.value)}
                    placeholder="Nombre, documento o contrato..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm"
                  />
                </div>
                <button
                  onClick={() => exportToExcel(filtradas, [
                    { header: 'Nombre', accessor: (r) => nombreDe(r) },
                    { header: 'ID', accessor: (r) => r.numeroId || '' },
                    { header: 'Contrato', accessor: (r) => r.contrato || '' },
                    { header: 'Celular', accessor: (r) => r.celular || '' },
                    { header: 'Apoderado', accessor: (r) => r.apoderado || '' },
                    { header: 'Teléfono apoderado', accessor: (r) => r.apoderadoTelefono || '' },
                    { header: 'Curso al pausar', accessor: (r) => r.cursoAlPausar || '' },
                    { header: 'Pausa', accessor: (r) => `${r.fechaOnHold || ''} → ${r.fechaFinOnHold || ''}` },
                    { header: 'Reactivación', accessor: (r) => modoTexto(r.modoReactivacion) },
                    { header: 'Reactivado', accessor: (r) => (r.reactivadoEn ? formatDateTime(r.reactivadoEn) : '') },
                    { header: 'Vence contrato', accessor: (r) => r.finalContrato || '' },
                  ], `reactivados-sin-salon-${new Date().toISOString().split('T')[0]}`)}
                  disabled={filtradas.length === 0}
                  className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md disabled:opacity-50"
                >
                  Excel
                </button>
              </div>
              <div className="mb-3 text-sm text-gray-600">
                {loading ? 'Cargando…' : `Mostrando ${filtradas.length} de ${rows.length} alumno(s)`}
              </div>

              {error ? (
                <div className="alert alert-error"><div className="ml-3 text-sm text-red-700">{error}</div></div>
              ) : filtradas.length === 0 && !loading ? (
                <div className="text-center py-10 text-gray-500">
                  <h3 className="text-sm font-medium text-gray-900">No hay alumnos reactivados sin salón</h3>
                  <p className="mt-1 text-sm">Todos los que volvieron del OnHold tienen curso asignado.</p>
                </div>
              ) : (
                <div className="table-container">
                  <table className="table">
                    <thead className="table-header">
                      <tr>
                        <th className="table-header-cell">Alumno</th>
                        <th className="table-header-cell">ID</th>
                        <th className="table-header-cell">Contacto</th>
                        <th className="table-header-cell">Curso al pausar</th>
                        <th className="table-header-cell">Pausa</th>
                        <th className="table-header-cell">Reactivación</th>
                        <th className="table-header-cell text-right">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="table-body">
                      {filtradas.map(r => (
                        <tr key={r.peopleId} className="hover:bg-gray-50">
                          <td className="table-cell">
                            <a href={`/student/${r.academicaId}`} target="_blank" rel="noopener noreferrer"
                              className="text-sm font-medium text-blue-600 hover:underline">{nombreDe(r)}</a>
                          </td>
                          <td className="table-cell text-sm text-gray-500">
                            <div>{r.numeroId || '—'}</div>
                            {r.contrato ? <div className="text-xs text-gray-400">{r.contrato}</div> : null}
                          </td>
                          <td className="table-cell text-sm text-gray-500">
                            <div>{r.celular || '—'}</div>
                            {r.apoderado || r.apoderadoTelefono ? (
                              <div className="text-xs text-gray-400">Apod.: {r.apoderado || '—'}{r.apoderadoTelefono ? ` · ${r.apoderadoTelefono}` : ''}</div>
                            ) : null}
                          </td>
                          <td className="table-cell text-sm text-gray-500">{r.cursoAlPausar || '—'}</td>
                          <td className="table-cell text-sm text-gray-500">{r.fechaOnHold || '—'} → {r.fechaFinOnHold || '—'}</td>
                          <td className="table-cell text-sm text-gray-500">
                            <div>{modoTexto(r.modoReactivacion)}</div>
                            {r.reactivadoEn ? <div className="text-xs text-gray-400">{formatDateTime(r.reactivadoEn)}</div> : null}
                          </td>
                          <td className="table-cell text-right">
                            <button
                              onClick={() => { setDestino(null); setTarget(r) }}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded-md"
                            >
                              Asignar salón
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        {target && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Asignar salón</h3>
              <p className="text-sm text-gray-600 mb-4">
                <span className="font-medium">{nombreDe(target)}</span>
                {target.cursoAlPausar ? <> · antes estaba en {target.cursoAlPausar}</> : null}
              </p>
              <p className="text-sm text-gray-500 mb-4">
                Entra en la lección por la que va el salón y se le agendan sus clases futuras.
              </p>
              <SalonDestinoSelector onChange={setDestino} />
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setTarget(null)} disabled={guardando}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">
                  Cancelar
                </button>
                <button onClick={asignar} disabled={!destino || guardando}
                  className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
                  {guardando ? 'Asignando…' : 'Asignar salón'}
                </button>
              </div>
            </div>
          </div>
        )}
      </PermissionGuard>
    </DashboardLayout>
  )
}
