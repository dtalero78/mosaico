'use client'

import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { CheckCircleIcon } from '@heroicons/react/24/outline'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { ServicioPermission } from '@/types/permissions'
import { exportToExcel } from '@/lib/export-excel'
import { usePermissions } from '@/hooks/usePermissions'

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
}
interface Guia { id: string; nombre: string }

function CasosAtencionContent() {
  const { hasPermission } = usePermissions()
  const canGestion = hasPermission(ServicioPermission.CASOS_ATENCION_GESTION as any)

  const [curso, setCurso] = useState('')
  const [salon, setSalon] = useState('')
  const [leccion, setLeccion] = useState('')
  const [guia, setGuia] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const [rows, setRows] = useState<Row[]>([])
  const [cursos, setCursos] = useState<string[]>([])
  const [salones, setSalones] = useState<string[]>([])
  const [lecciones, setLecciones] = useState<string[]>([])
  const [guias, setGuias] = useState<Guia[]>([])
  const [loading, setLoading] = useState(true)

  // Modal de "Resuelto"
  const [resolver, setResolver] = useState<Row | null>(null)
  const [comentario, setComentario] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async (f?: Record<string, string>) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      Object.entries(f || {}).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const r = await fetch(`/api/postgres/reports/servicio/casos-atencion?${qs}`, { cache: 'no-store' }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      setRows(r.rows || [])
      setCursos(r.cursos || []); setSalones(r.salones || []); setLecciones(r.lecciones || []); setGuias(r.guias || [])
    } catch (e: any) {
      toast.error(e?.message || 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const aplicar = () => fetchData({ curso, salon, leccion, guia, startDate, endDate })
  const borrar = () => {
    setCurso(''); setSalon(''); setLeccion(''); setGuia(''); setStartDate(''); setEndDate('')
    fetchData()
  }
  const exportar = () => {
    exportToExcel(rows, [
      { header: 'Curso', accessor: r => r.curso || '' },
      { header: 'Nombre', accessor: r => r.nombre || '' },
      { header: 'ID', accessor: r => r.numeroId || '' },
      { header: 'Salón', accessor: r => r.salon || '' },
      { header: 'Lección', accessor: r => r.leccion || '' },
      { header: 'Tema', accessor: r => r.tema || '' },
      { header: 'Guía', accessor: r => r.guia || '' },
      { header: 'Caso', accessor: r => r.caso || '' },
      { header: 'Conteo', accessor: r => (r.conteo ?? '') },
      { header: 'Fecha', accessor: r => (r.fecha ? new Date(r.fecha).toLocaleDateString('es-CL') : '') },
    ], 'casos-atencion')
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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Casos de Atención</h1>
      <p className="text-gray-500 mb-5">Estudiantes con un caso de atención abierto (registrado por el guía en la sesión). Total: <span className="font-semibold text-gray-700">{rows.length}</span></p>

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
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button type="button" onClick={aplicar} disabled={loading}
            className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium">Aplicar filtros</button>
          <button type="button" onClick={borrar}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Borrar filtros</button>
          <PermissionGuard permission={ServicioPermission.CASOS_ATENCION_EXPORTAR}>
            <button type="button" onClick={exportar} disabled={!rows.length}
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
                {['Curso', 'Nombre', 'Salón', 'Lección (tema)', 'Guía', 'Caso', 'Conteo', 'Fecha', 'Resuelto'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-3 py-10 text-center text-gray-400">Cargando…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-10 text-center text-gray-400">Sin casos de atención abiertos</td></tr>
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
                  <td className="px-3 py-2 text-gray-600 max-w-xs">
                    <span className="block whitespace-pre-wrap break-words">{r.caso || '—'}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">{r.conteo}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.fecha ? new Date(r.fecha).toLocaleDateString('es-CL') : '—'}</td>
                  <td className="px-3 py-2">
                    <button type="button" title="Marcar como resuelto (agrega un comentario al historial)"
                      onClick={() => { setResolver(r); setComentario('') }}
                      disabled={!canGestion}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed">
                      <CheckCircleIcon className="h-4 w-4" /> Resuelto
                    </button>
                  </td>
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
