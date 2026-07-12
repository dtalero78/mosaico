'use client'

import { useEffect, useState, useCallback } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { AcademicoPermission } from '@/types/permissions'
import { usePermissions } from '@/hooks/usePermissions'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

interface Row {
  _id: string; advisor: string; guiaNombre: string; curso: string; salon: string | null
  campaign: string | null; horario: string | null
  dia: string; repetirLeccion: string | null; fechaRepetirSesion: string | null; repetirMarcadoPor: string | null
}
interface Opciones { guias: { id: string; nombre: string }[]; cursos: string[]; salones: string[] }

function fmt(d: string | null) {
  if (!d) return '—'
  try { return new Date(d).toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return d }
}
function fmtDia(d: string | null) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('es', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) } catch { return d }
}

export default function SolicitudSesionesPage() {
  const { hasPermission, isRole } = usePermissions()
  const puedeGestionar = isRole('SUPER_ADMIN') || isRole('ADMIN') || hasPermission(AcademicoPermission.SOLICITUD_SESIONES_GESTION)

  const [rows, setRows] = useState<Row[]>([])
  const [opciones, setOpciones] = useState<Opciones>({ guias: [], cursos: [], salones: [] })
  const [loading, setLoading] = useState(true)

  // modal de autorización (por fila)
  const [modalRow, setModalRow] = useState<Row | null>(null)
  const [comentario, setComentario] = useState('')
  const [procesando, setProcesando] = useState(false)

  // filtros
  const [guia, setGuia] = useState('')
  const [curso, setCurso] = useState('')
  const [salon, setSalon] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    const qs = new URLSearchParams()
    if (guia) qs.set('guia', guia)
    if (curso) qs.set('curso', curso)
    if (salon) qs.set('salon', salon)
    if (startDate) qs.set('startDate', startDate)
    if (endDate) qs.set('endDate', endDate)
    fetch(`/api/postgres/reports/academico/solicitud-sesiones?${qs}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { setRows(d.rows || []); setOpciones(d.opciones || { guias: [], cursos: [], salones: [] }) })
      .catch(() => toast.error('Error al cargar solicitudes'))
      .finally(() => setLoading(false))
  }, [guia, curso, salon, startDate, endDate])
  useEffect(() => { load() }, [load])

  const abrirModal = (r: Row) => { setModalRow(r); setComentario('') }

  const resolver = async (autorizar: boolean) => {
    if (!modalRow) return
    setProcesando(true)
    try {
      const r = await fetch('/api/postgres/reports/academico/solicitud-sesiones/autorizar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventoId: modalRow._id, autorizar, comentario }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || j?.message || 'Error')
      if (autorizar) {
        toast.success(`Autorizado. ${j.sesionesCreadas ? `+${j.sesionesCreadas} sesión(es), curso hasta ${j.nuevoFinalCurso}` : 'sin extensión'}`)
      } else {
        toast.success('Solicitud rechazada')
      }
      setModalRow(null); load()
    } catch (e: any) { toast.error(e.message) } finally { setProcesando(false) }
  }

  const limpiar = () => { setGuia(''); setCurso(''); setSalon(''); setStartDate(''); setEndDate('') }

  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.SOLICITUD_SESIONES_VER} showDefaultMessage>
        <div className="p-6 max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Solicitud de Sesiones</h1>
          <p className="text-gray-500 mb-6">Solicitudes de <b>Repetir Lección</b> marcadas por los guías, pendientes de autorización.</p>

          {/* Filtros */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Guía</label>
              <select value={guia} onChange={e => setGuia(e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Todos</option>
                {opciones.guias.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Curso</label>
              <select value={curso} onChange={e => setCurso(e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Todos</option>
                {opciones.cursos.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Salón</label>
              <select value={salon} onChange={e => setSalon(e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Todos</option>
                {opciones.salones.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Desde (solicitud)</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Hasta (solicitud)</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>

          <div className="flex items-center gap-3 mb-3">
            <button type="button" onClick={limpiar} className="text-sm text-gray-500 hover:text-gray-700">Limpiar filtros</button>
            <span className="text-sm text-gray-400">{rows.length} solicitud(es)</span>
          </div>

          {/* Tabla */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Guía</th>
                    <th className="px-3 py-2 text-left">Campaña</th>
                    <th className="px-3 py-2 text-left">Curso</th>
                    <th className="px-3 py-2 text-left">Salón</th>
                    <th className="px-3 py-2 text-left">Lección solicitada</th>
                    <th className="px-3 py-2 text-left">Fecha del evento</th>
                    <th className="px-3 py-2 text-left">Fecha de solicitud</th>
                    {puedeGestionar && <th className="px-3 py-2 text-right">Acción</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400"><ArrowPathIcon className="w-5 h-5 animate-spin inline" /> Cargando…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">No hay solicitudes pendientes.</td></tr>
                  ) : rows.map(r => (
                    <tr key={r._id}>
                      <td className="px-3 py-2 font-medium text-gray-800">{r.guiaNombre}</td>
                      <td className="px-3 py-2">{r.campaign || '—'}</td>
                      <td className="px-3 py-2">{r.curso}</td>
                      <td className="px-3 py-2">{r.salon || '—'}</td>
                      <td className="px-3 py-2"><b>{r.repetirLeccion || '—'}</b></td>
                      <td className="px-3 py-2">{fmtDia(r.dia)}</td>
                      <td className="px-3 py-2">{fmt(r.fechaRepetirSesion)}</td>
                      {puedeGestionar && (
                        <td className="px-3 py-2 text-right">
                          <button type="button" onClick={() => abrirModal(r)}
                            className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700">Revisar</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Modal de autorización */}
        {modalRow && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-2">Autorizar repetición</h3>
              <p className="text-sm text-gray-600">
                Se repetirá <b>una sesión</b> para el curso <b>{modalRow.curso}</b>, salón <b>{modalRow.salon || '—'}</b>,
                lección <b>{modalRow.repetirLeccion || '—'}</b>, guía <b>{modalRow.guiaNombre}</b>.
              </p>
              <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                Al autorizar: se extiende el curso una semana si hace falta, se crean las sesiones + bookings para los usuarios del salón y el avance se detiene una lección.
              </p>
              <label className="block text-xs font-medium text-gray-500 mt-4 mb-1">Comentario (quién autoriza / motivo)</label>
              <textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Comentario de autorización…" />
              <div className="mt-5 flex justify-between gap-3">
                <button type="button" onClick={() => setModalRow(null)} disabled={procesando}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancelar</button>
                <div className="flex gap-2">
                  <button type="button" onClick={() => resolver(false)} disabled={procesando}
                    className="px-4 py-2 rounded-lg bg-red-100 text-red-700 font-medium hover:bg-red-200 disabled:opacity-40">No autorizar</button>
                  <button type="button" onClick={() => resolver(true)} disabled={procesando}
                    className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-40">
                    {procesando ? 'Procesando…' : 'Autorizar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </PermissionGuard>
    </DashboardLayout>
  )
}
