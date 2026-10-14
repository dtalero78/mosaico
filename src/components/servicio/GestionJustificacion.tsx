'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { DocumentTextIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { ServicioPermission } from '@/types/permissions'
import { usePermissions } from '@/hooks/usePermissions'
import { exportToExcel } from '@/lib/export-excel'
import { rangoUltimoMes, MAX_MOTIVO_JUSTIFICACION } from '@/lib/justificacion'

/**
 * Gestión Justificación — inasistencias y su justificación.
 *
 * Se usa en dos sitios:
 *  - Servicio › Gestión Justificación: los roles administrativos eligen el guía
 *    (o ven todos).
 *  - Panel Guía › pestaña "Justificaciones" (`guiaId` fijo = el guía del panel).
 *    Con el rol GUIA el servidor ignora cualquier guía pedido y usa el propio,
 *    así que un guía nunca ve los ausentes de otro.
 */

interface Row {
  bookingId: string
  academicaId: string
  peopleId: string
  nombre: string
  numeroId: string | null
  contrato: string | null
  campaign: string | null
  curso: string | null
  salon: string | null
  horario: string | null
  modulo: string | null
  leccion: string | null
  fecha: string | null
  guia: string | null
  apoderado: string | null
  apoderadoTelefono: string | null
  justificada: boolean
  motivo: string | null
  justificadoPorNombre: string | null
  justificadoPor: string | null
  justificadoEn: string | null
}
interface Guia { id: string; nombre: string }
type Estado = 'pendientes' | 'justificadas'

const PAGE = 50

const fmtFecha = (iso: string | null) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('es', {
      weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
  } catch { return iso }
}

const filtrosIniciales = () => {
  const r = rangoUltimoMes()
  return { usuario: '', campaign: '', curso: '', salon: '', guiaId: '', startDate: r.desde, endDate: r.hasta }
}

export default function GestionJustificacion({ guiaId: guiaFijo, embedded = false }: { guiaId?: string; embedded?: boolean }) {
  const { hasPermission } = usePermissions()
  const puedeJustificar = hasPermission(ServicioPermission.JUSTIFICACION_JUSTIFICAR as any)
  const puedeExportar = hasPermission(ServicioPermission.JUSTIFICACION_EXPORTAR as any)

  const [f, setF] = useState(filtrosIniciales)
  const [applied, setApplied] = useState(f)
  const [estado, setEstado] = useState<Estado>('pendientes')
  const [rows, setRows] = useState<Row[]>([])
  const [meta, setMeta] = useState<any>({})
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<{ row: Row; modo: 'justificar' | 'quitar' } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  // Sólo pinta la ÚLTIMA consulta pedida: al cambiar de pestaña o de guía deprisa,
  // una respuesta vieja que llega tarde no debe pisar la nueva.
  const reqRef = useRef(0)

  const cargar = useCallback(async () => {
    const id = ++reqRef.current
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      Object.entries(applied).forEach(([k, v]) => { if (v) qs.set(k, v) })
      if (guiaFijo) qs.set('guiaId', guiaFijo)
      qs.set('estado', estado)
      const res = await fetch(`/api/postgres/servicio/justificaciones?${qs}`, { cache: 'no-store' }).then(r => r.json())
      if (id !== reqRef.current) return
      if (res.error) throw new Error(res.error)
      setRows(res.rows || [])
      setMeta(res)
      setPage(1)
    } catch (e: any) {
      if (id === reqRef.current) toast.error(e?.message || 'Error al cargar las inasistencias')
    } finally {
      if (id === reqRef.current) setLoading(false)
    }
  }, [applied, estado, guiaFijo])

  useEffect(() => { cargar() }, [cargar])

  const aplicar = () => setApplied({ ...f })
  const borrar = () => { const n = filtrosIniciales(); setF(n); setApplied(n) }

  const visibles = useMemo(() => rows.slice((page - 1) * PAGE, page * PAGE), [rows, page])
  const paginas = Math.max(1, Math.ceil(rows.length / PAGE))
  const mostrarGuia = !embedded && !meta.soloPropios
  const guias: Guia[] = meta.guias || []

  const abrir = (row: Row, modo: 'justificar' | 'quitar') => {
    setMotivo(modo === 'justificar' ? (row.motivo || '') : '')
    setModal({ row, modo })
  }

  const confirmar = async () => {
    if (!modal) return
    const justificar = modal.modo === 'justificar'
    if (justificar && !motivo.trim()) { toast.error('Escribe el motivo'); return }
    setGuardando(true)
    try {
      const res = await fetch('/api/postgres/servicio/justificaciones/justificar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: modal.row.bookingId, justificar, motivo: motivo.trim() }),
      }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      toast.success(justificar ? 'Inasistencia justificada' : 'Justificación quitada')
      setModal(null)
      // Sale de la pestaña actual: se recarga para que los contadores cuadren.
      cargar()
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo guardar')
    } finally { setGuardando(false) }
  }

  const exportar = () => {
    if (!rows.length) { toast.error('No hay filas para exportar'); return }
    exportToExcel(rows, [
      { header: 'Fecha sesión', accessor: r => fmtFecha(r.fecha) },
      { header: 'Alumno', accessor: r => r.nombre },
      { header: 'ID', accessor: r => r.numeroId },
      { header: 'Contrato', accessor: r => r.contrato },
      { header: 'Campaña', accessor: r => r.campaign },
      { header: 'Curso', accessor: r => r.curso },
      { header: 'Salón', accessor: r => r.salon },
      { header: 'Horario', accessor: r => r.horario },
      { header: 'Módulo', accessor: r => r.modulo },
      { header: 'Lección', accessor: r => r.leccion },
      { header: 'Guía', accessor: r => r.guia },
      { header: 'Apoderado', accessor: r => r.apoderado },
      { header: 'Teléfono apoderado', accessor: r => r.apoderadoTelefono },
      { header: 'Justificada', accessor: r => (r.justificada ? 'Sí' : 'No') },
      { header: 'Motivo', accessor: r => r.motivo },
      { header: 'Justificado por', accessor: r => r.justificadoPorNombre || r.justificadoPor },
      { header: 'Justificado el', accessor: r => (r.justificadoEn ? new Date(r.justificadoEn).toLocaleString('es') : '') },
    ], `justificaciones_${estado}_${applied.startDate}_${applied.endDate}`)
  }

  const input = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500'
  const label = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${mostrarGuia ? 'lg:grid-cols-7' : 'lg:grid-cols-6'}`}>
          <div className="lg:col-span-2">
            <label className={label} htmlFor="gj-usuario">Nombre, ID o contrato</label>
            <input id="gj-usuario" className={input} value={f.usuario}
              placeholder="Ej. Pérez, 24777856K o 2341-26"
              onChange={e => setF({ ...f, usuario: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') aplicar() }} />
          </div>
          <div>
            <label className={label} htmlFor="gj-campaign">Campaña</label>
            <select id="gj-campaign" className={input} value={f.campaign} onChange={e => setF({ ...f, campaign: e.target.value })}>
              <option value="">Todas</option>
              {(meta.campanias || []).map((c: string) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="gj-curso">Curso</label>
            <select id="gj-curso" className={input} value={f.curso} onChange={e => setF({ ...f, curso: e.target.value })}>
              <option value="">Todos</option>
              {(meta.cursos || []).map((c: string) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="gj-salon">Salón</label>
            <select id="gj-salon" className={input} value={f.salon} onChange={e => setF({ ...f, salon: e.target.value })}>
              <option value="">Todos</option>
              {(meta.salones || []).map((s: string) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {mostrarGuia && (
            <div>
              <label className={label} htmlFor="gj-guia">Guía</label>
              <select id="gj-guia" className={input} value={f.guiaId} onChange={e => setF({ ...f, guiaId: e.target.value })}>
                <option value="">Todos</option>
                {guias.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className={label} htmlFor="gj-desde">Fecha inicial</label>
            <input id="gj-desde" type="date" className={input} value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor="gj-hasta">Fecha final</label>
            <input id="gj-hasta" type="date" className={input} value={f.endDate} onChange={e => setF({ ...f, endDate: e.target.value })} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={aplicar}
            className="px-4 py-2 text-sm font-semibold text-white bg-primary-600 rounded-md hover:bg-primary-700">
            Aplicar filtros
          </button>
          <button type="button" onClick={borrar}
            className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">
            Borrar filtros
          </button>
          {puedeExportar && (
            <button type="button" onClick={exportar}
              className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-green-800 bg-green-100 rounded-md hover:bg-green-200">
              <ArrowDownTrayIcon className="h-4 w-4" /> Exportar CSV
            </button>
          )}
        </div>
        {meta.soloPropios && !embedded && (
          <p className="mt-2 text-xs text-gray-500">Se muestran sólo los ausentes de tus cursos.</p>
        )}
      </div>

      {/* Pestañas */}
      <div className="border-b border-gray-200 flex gap-6">
        {([['pendientes', 'Sin justificar', meta.pendientes], ['justificadas', 'Justificadas', meta.justificadas]] as const).map(([k, l, n]) => (
          <button key={k} type="button" onClick={() => setEstado(k)}
            className={`py-2 px-1 border-b-2 text-sm font-medium ${estado === k ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {l} <span className="text-gray-400">({n ?? 0})</span>
          </button>
        ))}
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
        {meta.truncado && (
          <p className="px-4 py-2 text-xs text-amber-800 bg-amber-50">Se muestran las primeras 5.000 inasistencias: acota los filtros para ver el resto.</p>
        )}
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Sesión</th>
              <th className="px-4 py-3">Alumno</th>
              <th className="px-4 py-3">Curso · Salón</th>
              <th className="px-4 py-3">Lección</th>
              <th className="px-4 py-3">Guía</th>
              <th className="px-4 py-3">{estado === 'justificadas' ? 'Motivo' : 'Apoderado'}</th>
              {puedeJustificar && <th className="px-4 py-3 text-right">Acción</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Cargando…</td></tr>
            ) : visibles.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                {estado === 'pendientes' ? 'No hay inasistencias sin justificar en el período.' : 'No hay inasistencias justificadas en el período.'}
              </td></tr>
            ) : visibles.map(r => (
              <tr key={r.bookingId} className="hover:bg-gray-50 align-top">
                <td className="px-4 py-3 whitespace-nowrap text-gray-700">{fmtFecha(r.fecha)}</td>
                <td className="px-4 py-3">
                  <a href={`/student/${r.academicaId}`} target="_blank" rel="noopener noreferrer"
                    className="font-medium text-primary-700 hover:underline">{r.nombre}</a>
                  <div className="text-xs text-gray-500">ID {r.numeroId || '—'} · {r.contrato || '—'}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">{r.campaign || '—'}</div>
                  <div className="text-gray-800">{r.curso || '—'} · {r.salon || '—'}</div>
                  <div className="text-xs text-gray-500">{r.horario || ''}</div>
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {r.leccion || '—'}
                  {r.modulo && <div className="text-xs text-gray-500">{r.modulo}</div>}
                </td>
                <td className="px-4 py-3 text-gray-700">{r.guia || '—'}</td>
                <td className="px-4 py-3 max-w-xs">
                  {estado === 'justificadas' ? (
                    <>
                      <p className="text-gray-800 whitespace-pre-wrap break-words">{r.motivo || '—'}</p>
                      {(r.justificadoPorNombre || r.justificadoEn) && (
                        <p className="mt-1 text-xs text-gray-500">
                          {r.justificadoPorNombre || r.justificadoPor}{r.justificadoEn ? ` · ${new Date(r.justificadoEn).toLocaleString('es')}` : ''}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-gray-800">{r.apoderado || '—'}</p>
                      <p className="text-xs text-gray-500">{r.apoderadoTelefono || ''}</p>
                    </>
                  )}
                </td>
                {puedeJustificar && (
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {r.justificada ? (
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => abrir(r, 'justificar')}
                          className="px-3 py-1.5 text-xs font-semibold text-sky-700 bg-sky-50 rounded hover:bg-sky-100">Editar motivo</button>
                        <button type="button" onClick={() => abrir(r, 'quitar')}
                          className="px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 rounded hover:bg-red-100">Quitar</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => abrir(r, 'justificar')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-sky-600 rounded hover:bg-sky-700">
                        <DocumentTextIcon className="h-4 w-4" /> Justificar
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > PAGE && (
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-gray-600">
            <span>{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, rows.length)} de {rows.length}</span>
            <div className="flex gap-2">
              <button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1 rounded border disabled:opacity-40">Anterior</button>
              <button type="button" disabled={page === paginas} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 rounded border disabled:opacity-40">Siguiente</button>
            </div>
          </div>
        )}
      </div>

      {/* Modal justificar / quitar */}
      {modal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black bg-opacity-60">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              {modal.modo === 'quitar' ? 'Quitar justificación' : 'Justificar inasistencia'}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              <b>{modal.row.nombre}</b> · {modal.row.curso} {modal.row.salon} · {fmtFecha(modal.row.fecha)}
            </p>
            {modal.modo === 'justificar' ? (
              <>
                <label className={label} htmlFor="gj-motivo">Motivo de la ausencia *</label>
                <textarea id="gj-motivo" rows={4} className={input} value={motivo} maxLength={MAX_MOTIVO_JUSTIFICACION}
                  onChange={e => setMotivo(e.target.value)} autoFocus />
                <p className="mt-2 text-xs text-gray-500">
                  La falta sigue contando como ausencia; queda registrada como justificada con este motivo.
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-700">
                La inasistencia vuelve a quedar <b>sin justificar</b> y se borra el motivo
                («{modal.row.motivo || '—'}»).
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setModal(null)} disabled={guardando}
                className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 rounded hover:bg-gray-200">Cancelar</button>
              <button type="button" onClick={confirmar}
                disabled={guardando || (modal.modo === 'justificar' && !motivo.trim())}
                className={`px-4 py-2 text-sm font-semibold text-white rounded disabled:opacity-50 ${modal.modo === 'quitar' ? 'bg-red-600 hover:bg-red-700' : 'bg-sky-600 hover:bg-sky-700'}`}>
                {guardando ? 'Guardando…' : modal.modo === 'quitar' ? 'Quitar justificación' : 'Justificar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
