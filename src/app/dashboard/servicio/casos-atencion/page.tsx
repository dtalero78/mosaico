'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import toast from 'react-hot-toast'
import { CheckCircleIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { ServicioPermission } from '@/types/permissions'
import { exportToExcel } from '@/lib/export-excel'
import { usePermissions } from '@/hooks/usePermissions'

/** Las tres vistas de la pantalla. Los filtros son los mismos para todas. */
type Tab = 'casos' | 'asistencia' | 'vacias'

const TABS: Array<{ id: Tab; label: string; endpoint: string; vacio: string; descripcion: string }> = [
  {
    id: 'casos', label: 'Casos de Atención',
    endpoint: '/api/postgres/reports/servicio/casos-atencion',
    vacio: 'Sin casos de atención abiertos',
    descripcion: 'Estudiantes con un caso de atención abierto (registrado por el guía en la sesión).',
  },
  {
    id: 'asistencia', label: 'Asistencia',
    endpoint: '/api/postgres/reports/servicio/casos-atencion/asistencia',
    vacio: 'No hubo inasistentes',
    descripcion: 'Estudiantes que no asistieron a las sesiones de la semana.',
  },
  {
    id: 'vacias', label: 'Sesiones vacías',
    endpoint: '/api/postgres/reports/servicio/casos-atencion/sesiones-vacias',
    vacio: 'No hubo clases vacías',
    descripcion: 'Sesiones de la semana a las que no asistió ningún estudiante, agrupadas por curso y salón.',
  },
]

interface Row {
  bookingId: string
  academicaId: string
  curso: string | null
  nombre: string
  numeroId: string | null
  salon: string | null
  leccion: string | null
  tema: string | null
  guia: string | null
  caso: string | null
  conteo: number
  fecha: string | null
  // Sólo en la pestaña Asistencia
  contactadoApoderado?: boolean
  recordatorioEnviado?: boolean
  apoderado?: string | null
  apoderadoTelefono?: string | null
}
interface SesionVacia {
  eventoId: string
  curso: string | null
  salon: string | null
  leccion: string | null
  tema: string | null
  guia: string | null
  fecha: string | null
  inscritos: number
}
interface Grupo { curso: string; salon: string; sesiones: SesionVacia[] }
interface Guia { id: string; nombre: string }

const fmtFecha = (f: string | null) => (f ? new Date(f).toLocaleDateString('es-CL') : '—')

function CasosAtencionContent() {
  const { hasPermission } = usePermissions()
  const canGestion = hasPermission(ServicioPermission.CASOS_ATENCION_GESTION as any)

  const [tab, setTab] = useState<Tab>('casos')
  const cfg = TABS.find(t => t.id === tab)!

  const [curso, setCurso] = useState('')
  const [salon, setSalon] = useState('')
  const [leccion, setLeccion] = useState('')
  const [guia, setGuia] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const [rows, setRows] = useState<Row[]>([])
  const [grupos, setGrupos] = useState<Grupo[]>([])
  const [total, setTotal] = useState(0)
  const [cursos, setCursos] = useState<string[]>([])
  const [salones, setSalones] = useState<string[]>([])
  const [lecciones, setLecciones] = useState<string[]>([])
  const [guias, setGuias] = useState<Guia[]>([])
  const [loading, setLoading] = useState(true)

  // Modal de "Resuelto" (pestaña Casos)
  const [resolver, setResolver] = useState<Row | null>(null)
  const [comentario, setComentario] = useState('')
  const [saving, setSaving] = useState(false)

  // Confirmación del WhatsApp (pestaña Asistencia)
  const [recordar, setRecordar] = useState<Row | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [marcando, setMarcando] = useState<string | null>(null)

  const fetchData = useCallback(async (t: Tab, f?: Record<string, string>) => {
    setLoading(true)
    try {
      const conf = TABS.find(x => x.id === t)!
      const qs = new URLSearchParams()
      Object.entries(f || {}).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const r = await fetch(`${conf.endpoint}?${qs}`, { cache: 'no-store' }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      setRows(r.rows || [])
      setGrupos(r.grupos || [])
      setTotal(r.total ?? (r.rows?.length || 0))
      setCursos(r.cursos || []); setSalones(r.salones || []); setLecciones(r.lecciones || []); setGuias(r.guias || [])
    } catch (e: any) {
      toast.error(e?.message || 'Error al cargar')
      setRows([]); setGrupos([]); setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData(tab) }, [tab, fetchData])

  const filtros = { curso, salon, leccion, guia, startDate, endDate }
  const aplicar = () => fetchData(tab, filtros)
  const borrar = () => {
    setCurso(''); setSalon(''); setLeccion(''); setGuia(''); setStartDate(''); setEndDate('')
    fetchData(tab)
  }
  const cambiarTab = (t: Tab) => {
    setCurso(''); setSalon(''); setLeccion(''); setGuia(''); setStartDate(''); setEndDate('')
    setTab(t)
  }

  const exportar = () => {
    if (tab === 'vacias') {
      const planas = grupos.flatMap(g => g.sesiones.map(s => ({ ...s, curso: g.curso, salon: g.salon })))
      exportToExcel(planas, [
        { header: 'Curso', accessor: r => r.curso || '' },
        { header: 'Salón', accessor: r => r.salon || '' },
        { header: 'Inscritos que faltaron', accessor: r => (r.inscritos ?? '') },
        { header: 'Lección', accessor: r => r.leccion || '' },
        { header: 'Tema', accessor: r => r.tema || '' },
        { header: 'Guía', accessor: r => r.guia || '' },
        { header: 'Fecha', accessor: r => fmtFecha(r.fecha) },
      ], 'sesiones-vacias')
      return
    }
    const cols: any[] = [
      { header: 'Curso', accessor: (r: Row) => r.curso || '' },
      { header: 'Nombre', accessor: (r: Row) => r.nombre || '' },
      { header: 'ID', accessor: (r: Row) => r.numeroId || '' },
      { header: 'Salón', accessor: (r: Row) => r.salon || '' },
      { header: 'Lección', accessor: (r: Row) => r.leccion || '' },
      { header: 'Tema', accessor: (r: Row) => r.tema || '' },
      { header: 'Guía', accessor: (r: Row) => r.guia || '' },
    ]
    if (tab === 'casos') {
      cols.push(
        { header: 'Caso', accessor: (r: Row) => r.caso || '' },
        { header: 'Conteo', accessor: (r: Row) => (r.conteo ?? '') },
      )
    } else {
      cols.push(
        { header: 'Contactado apoderado', accessor: (r: Row) => (r.contactadoApoderado ? 'Sí' : 'No') },
        { header: 'Recordatorio enviado', accessor: (r: Row) => (r.recordatorioEnviado ? 'Sí' : 'No') },
      )
    }
    cols.push({ header: 'Fecha', accessor: (r: Row) => fmtFecha(r.fecha) })
    exportToExcel(rows, cols, tab === 'casos' ? 'casos-atencion' : 'inasistencias-semana')
  }

  const confirmarResuelto = async () => {
    if (!resolver) return
    if (!comentario.trim()) { toast.error('El comentario es obligatorio'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/postgres/students/${resolver.academicaId}/caso-atencion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: resolver.bookingId, comentario: comentario.trim() }),
      }).then(x => x.json())
      if (res.error) throw new Error(res.error)
      toast.success('Caso marcado como resuelto')
      setRows(prev => prev.filter(x => x.bookingId !== resolver.bookingId))
      setResolver(null); setComentario('')
    } catch (e: any) {
      toast.error(e?.message || 'Error')
    } finally {
      setSaving(false)
    }
  }

  const marcarContactado = async (r: Row, valor: boolean) => {
    setMarcando(r.bookingId)
    // Optimista: la casilla responde al instante y se revierte si falla.
    setRows(prev => prev.map(x => x.bookingId === r.bookingId ? { ...x, contactadoApoderado: valor } : x))
    try {
      const res = await fetch('/api/postgres/reports/servicio/casos-atencion/asistencia/contactado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: r.bookingId, academicaId: r.academicaId, numeroId: r.numeroId, contactado: valor }),
      }).then(x => x.json())
      if (res.error) throw new Error(res.error)
    } catch (e: any) {
      setRows(prev => prev.map(x => x.bookingId === r.bookingId ? { ...x, contactadoApoderado: !valor } : x))
      toast.error(e?.message || 'No se pudo guardar')
    } finally {
      setMarcando(null)
    }
  }

  const confirmarRecordatorio = async () => {
    if (!recordar) return
    setEnviando(true)
    try {
      const res = await fetch('/api/postgres/reports/servicio/casos-atencion/asistencia/recordatorio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: recordar.bookingId }),
      }).then(x => x.json())
      if (res.error) throw new Error(res.error)
      toast.success(`Recordatorio enviado al ${res.destinatario} (${res.to})`)
      setRows(prev => prev.map(x => x.bookingId === recordar.bookingId ? { ...x, recordatorioEnviado: true } : x))
      setRecordar(null)
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo enviar')
    } finally {
      setEnviando(false)
    }
  }

  const hayDatos = tab === 'vacias' ? grupos.length > 0 : rows.length > 0
  const columnas = tab === 'casos'
    ? ['Curso', 'Nombre', 'Salón', 'Lección (tema)', 'Guía', 'Caso', 'Conteo', 'Fecha', 'Resuelto']
    : tab === 'asistencia'
      ? ['Curso', 'Nombre', 'Salón', 'Lección (tema)', 'Guía', 'Fecha', 'Contactado apoderado', 'Envío recordatorio']
      : ['Curso', 'Faltaron', 'Salón', 'Lección (tema)', 'Guía', 'Fecha']

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Casos de Atención</h1>
      <p className="text-gray-500 mb-4">
        {cfg.descripcion} Total: <span className="font-semibold text-gray-700">{total}</span>
      </p>

      {/* Pestañas */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200 mb-5">
        {TABS.map(t => (
          <button
            key={t.id} type="button" onClick={() => cambiarTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Curso</label>
            <select value={curso} onChange={e => setCurso(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>{cursos.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Salón</label>
            <select value={salon} onChange={e => setSalon(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>{salones.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Lección</label>
            <select value={leccion} onChange={e => setLeccion(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todas</option>{lecciones.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Guía</label>
            <select value={guia} onChange={e => setGuia(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>{guias.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Fecha inicial</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Fecha final</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>
        {tab !== 'casos' && !startDate && !endDate && (
          <p className="text-xs text-gray-400 mt-2">Mostrando la semana en curso (lunes a domingo). Usa las fechas para consultar otro período.</p>
        )}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button type="button" onClick={aplicar} disabled={loading}
            className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium">Aplicar filtros</button>
          <button type="button" onClick={borrar}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Borrar filtros</button>
          <PermissionGuard permission={ServicioPermission.CASOS_ATENCION_EXPORTAR}>
            <button type="button" onClick={exportar} disabled={!hayDatos}
              className="px-3 py-2 text-sm bg-green-100 text-green-700 rounded-lg hover:bg-green-200 disabled:opacity-50 font-medium">Exportar CSV</button>
          </PermissionGuard>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {columnas.map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={columnas.length} className="px-3 py-10 text-center text-gray-400">Cargando…</td></tr>
              ) : !hayDatos ? (
                <tr><td colSpan={columnas.length} className="px-3 py-10 text-center text-gray-400">{cfg.vacio}</td></tr>
              ) : tab === 'vacias' ? (
                grupos.map(g => (
                  <Fragment key={`${g.curso}-${g.salon}`}>
                    <tr className="bg-primary-50/60 border-y border-primary-100">
                      <td colSpan={columnas.length} className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-primary-700">
                        {g.curso} · Salón {g.salon}
                        <span className="ml-2 font-medium text-primary-600/70 normal-case">
                          {g.sesiones.length} sesión(es) sin asistentes
                        </span>
                      </td>
                    </tr>
                    {g.sesiones.map(s => (
                      <tr key={s.eventoId} className="border-b border-gray-100 hover:bg-gray-50 align-top">
                        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{s.curso || '—'}</td>
                        <td className="px-3 py-2">
                          {/* Sin inscritos ≠ nadie asistió: lo primero suele ser
                              que al curso no se le generaron los agendamientos. */}
                          {s.inscritos > 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                              {s.inscritos} inscrito(s), 0 asistieron
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-200 text-gray-600"
                              title="La sesión no tiene ningún estudiante agendado">
                              Sin inscritos
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{s.salon || '—'}</td>
                        <td className="px-3 py-2 text-gray-600">
                          <span className="font-medium text-gray-800">{s.leccion || '—'}</span>
                          {s.tema && <span className="block text-xs text-gray-400">{s.tema}</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{s.guia || '—'}</td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtFecha(s.fecha)}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))
              ) : rows.map((r) => (
                <tr key={r.bookingId} className="border-b border-gray-100 hover:bg-gray-50 align-top">
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{r.curso || '—'}</td>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    {r.nombre ? (
                      <button
                        type="button"
                        onClick={() => window.open(`/student/${r.academicaId}`, '_blank', 'noopener,noreferrer')}
                        className="text-primary-600 hover:text-primary-800 hover:underline"
                        title="Ver perfil del beneficiario"
                      >
                        {r.nombre}
                      </button>
                    ) : <span className="text-gray-900">—</span>}
                    {r.numeroId && <span className="block text-xs text-gray-400">{r.numeroId}</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{r.salon || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">
                    <span className="font-medium text-gray-800">{r.leccion || '—'}</span>
                    {r.tema && <span className="block text-xs text-gray-400">{r.tema}</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.guia || '—'}</td>

                  {tab === 'casos' ? (
                    <>
                      <td className="px-3 py-2 text-gray-600 max-w-xs">
                        <span className="block whitespace-pre-wrap break-words">{r.caso || '—'}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">{r.conteo}</span>
                      </td>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtFecha(r.fecha)}</td>
                      <td className="px-3 py-2">
                        <button type="button" title="Marcar como resuelto (agrega un comentario al historial)"
                          onClick={() => { setResolver(r); setComentario('') }}
                          disabled={!canGestion}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed">
                          <CheckCircleIcon className="h-4 w-4" /> Resuelto
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtFecha(r.fecha)}</td>
                      <td className="px-3 py-2">
                        <label className={`inline-flex items-center gap-2 ${canGestion ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                          <input
                            type="checkbox"
                            checked={!!r.contactadoApoderado}
                            disabled={!canGestion || marcando === r.bookingId}
                            onChange={e => marcarContactado(r, e.target.checked)}
                            className="h-4 w-4 accent-emerald-600"
                          />
                          <span className="text-xs text-gray-600">
                            {r.contactadoApoderado ? 'Contactado' : 'Pendiente'}
                          </span>
                        </label>
                        {r.apoderado && <span className="block text-xs text-gray-400 mt-0.5">{r.apoderado}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <button type="button"
                          title={r.recordatorioEnviado ? 'Ya se envió — puedes volver a enviarlo' : 'Enviar recordatorio por WhatsApp'}
                          onClick={() => setRecordar(r)}
                          disabled={!canGestion}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed ${
                            r.recordatorioEnviado
                              ? 'text-gray-600 bg-gray-100 hover:bg-gray-200'
                              : 'text-green-700 bg-green-50 hover:bg-green-100'
                          }`}>
                          <ChatBubbleLeftRightIcon className="h-4 w-4" />
                          {r.recordatorioEnviado ? 'Reenviar' : 'Enviar'}
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Resuelto */}
      {resolver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setResolver(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Marcar caso como resuelto</h3>
            <p className="text-sm text-gray-500 mb-4">
              {resolver.nombre} — {resolver.curso || '—'} · Lección {resolver.leccion || '—'}
            </p>
            {resolver.caso && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4 text-sm text-gray-700">
                <p className="text-xs font-semibold text-gray-500 mb-1">Caso registrado por el guía:</p>
                <p className="whitespace-pre-wrap break-words">{resolver.caso}</p>
              </div>
            )}
            <label className="block text-sm font-medium text-gray-700 mb-1">Comentario para el usuario <span className="text-red-500">*</span></label>
            <textarea
              value={comentario}
              onChange={e => setComentario(e.target.value)}
              rows={4}
              autoFocus
              placeholder="Describe cómo se resolvió el caso de atención…"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
            <p className="text-xs text-gray-400 mt-1">Se agrega al historial del estudiante y cierra el caso.</p>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setResolver(null)} disabled={saving}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={confirmarResuelto} disabled={saving || !comentario.trim()}
                className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 font-medium">
                {saving ? 'Guardando…' : 'Confirmar Resuelto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmación del recordatorio por WhatsApp */}
      {recordar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !enviando && setRecordar(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Enviar recordatorio por WhatsApp</h3>
            <p className="text-sm text-gray-500 mb-4">
              {recordar.nombre} — {recordar.curso || '—'} · Lección {recordar.leccion || '—'} · {fmtFecha(recordar.fecha)}
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-800">
              Se enviará un aviso de inasistencia. En YOJI, OKINA, KODOMO y DANSHI va al <b>apoderado</b>;
              en SENPAI e IMPULSA, al <b>estudiante</b>.
              {recordar.recordatorioEnviado && <span className="block mt-1 font-semibold">Ya se envió antes: este sería un reenvío.</span>}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRecordar(null)} disabled={enviando}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={confirmarRecordatorio} disabled={enviando}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium">
                {enviando ? 'Enviando…' : 'Enviar recordatorio'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function CasosAtencionPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={ServicioPermission.CASOS_ATENCION_VER} showDefaultMessage>
        <CasosAtencionContent />
      </PermissionGuard>
    </DashboardLayout>
  )
}
