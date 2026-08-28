'use client'

import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { ServicioPermission } from '@/types/permissions'
import { exportToExcel } from '@/lib/export-excel'
import { usePermissions } from '@/hooks/usePermissions'
import NivelacionesAgrupacionesTab from '@/components/servicio/NivelacionesAgrupacionesTab'
import NivelacionesPendientesTab from '@/components/servicio/NivelacionesPendientesTab'
import NivelacionesHistorialTab from '@/components/servicio/NivelacionesHistorialTab'

interface Row {
  academicaId: string
  curso: string | null
  nombre: string
  salon: string | null
  leccion: string | null
  tema: string | null
  guia: string | null
  conteo: number
  fecha: string | null
}
interface Guia { id: string; nombre: string }

type Tab = 'solicitudes' | 'agrupaciones' | 'pendientes' | 'historial'

/**
 * Solicitudes: lo que el Guía pidió y aún nadie resolvió (ACADEMICA.nivelacion).
 * Aprobar aquí NO agenda: marca la solicitud como aprobada y la manda a
 * Agrupaciones, donde se juntan por curso y lección para dictar UNA nivelación
 * a varios alumnos en vez de una por cabeza.
 */
function SolicitudesTab({ onCount }: { onCount?: (n: number) => void }) {
  const { hasPermission } = usePermissions()
  const canGestion = hasPermission(ServicioPermission.NIVELACIONES_GESTION as any)

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
  const [acting, setActing] = useState<string | null>(null)

  const fetchData = useCallback(async (f?: Record<string, string>) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      Object.entries(f || {}).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const r = await fetch(`/api/postgres/reports/servicio/nivelaciones?${qs}`, { cache: 'no-store' }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      setRows(r.rows || [])
      setCursos(r.cursos || []); setSalones(r.salones || []); setLecciones(r.lecciones || []); setGuias(r.guias || [])
      onCount?.(r.rows?.length || 0)
    } catch (e: any) {
      toast.error(e?.message || 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [onCount])

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
      { header: 'Salón', accessor: r => r.salon || '' },
      { header: 'Lección', accessor: r => r.leccion || '' },
      { header: 'Tema', accessor: r => r.tema || '' },
      { header: 'Guía', accessor: r => r.guia || '' },
      { header: 'Conteo', accessor: r => (r.conteo ?? '') },
      { header: 'Fecha', accessor: r => (r.fecha ? new Date(r.fecha).toLocaleDateString('es-CL') : '') },
    ], 'nivelaciones')
  }

  const accion = async (r: Row, tipo: 'aprobar' | 'cancelar') => {
    setActing(r.academicaId + tipo)
    try {
      const res = await fetch(`/api/postgres/students/${r.academicaId}/nivelacion`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [tipo]: true }),
      }).then(x => x.json())
      if (res.error) throw new Error(res.error)
      toast.success(tipo === 'aprobar' ? 'Aprobada — pasa a Agrupaciones' : 'Nivelación cancelada')
      // quitar la fila de la lista (ya resuelta)
      setRows(prev => {
        const next = prev.filter(x => x.academicaId !== r.academicaId)
        onCount?.(next.length)
        return next
      })
    } catch (e: any) {
      toast.error(e?.message || 'Error')
    } finally {
      setActing(null)
    }
  }

  return (
    <div>
      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div>
            <label htmlFor="so-curso" className="block text-xs font-medium text-gray-500 mb-1">Curso</label>
            <select id="so-curso" value={curso} onChange={e => setCurso(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>{cursos.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="so-salon" className="block text-xs font-medium text-gray-500 mb-1">Salón</label>
            <select id="so-salon" value={salon} onChange={e => setSalon(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>{salones.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="so-leccion" className="block text-xs font-medium text-gray-500 mb-1">Lección</label>
            <select id="so-leccion" value={leccion} onChange={e => setLeccion(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todas</option>{lecciones.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="so-guia" className="block text-xs font-medium text-gray-500 mb-1">Guía</label>
            <select id="so-guia" value={guia} onChange={e => setGuia(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>{guias.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="so-desde" className="block text-xs font-medium text-gray-500 mb-1">Fecha inicial</label>
            <input id="so-desde" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label htmlFor="so-hasta" className="block text-xs font-medium text-gray-500 mb-1">Fecha final</label>
            <input id="so-hasta" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button type="button" onClick={aplicar} disabled={loading}
            className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium">Aplicar filtros</button>
          <button type="button" onClick={borrar}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Borrar filtros</button>
          <PermissionGuard permission={ServicioPermission.NIVELACIONES_EXPORTAR}>
            <button type="button" onClick={exportar} disabled={!rows.length}
              className="px-3 py-2 text-sm bg-green-100 text-green-700 rounded-lg hover:bg-green-200 disabled:opacity-50 font-medium">Exportar CSV</button>
          </PermissionGuard>
          <span className="ml-auto text-sm text-gray-500">
            Pendientes: <span className="font-semibold text-gray-700">{rows.length}</span>
          </span>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Curso', 'Nombre', 'Salón', 'Lección (tema)', 'Guía', 'Conteo', 'Aprobar', 'Cancelar'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">Cargando…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">Sin nivelaciones pendientes</td></tr>
              ) : rows.map((r) => (
                <tr key={r.academicaId} className="border-b border-gray-100 hover:bg-gray-50">
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
                  </td>
                  <td className="px-3 py-2 text-gray-600">{r.salon || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">
                    <span className="font-medium text-gray-800">{r.leccion || '—'}</span>
                    {r.tema && <span className="block text-xs text-gray-400">{r.tema}</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.guia || '—'}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">{r.conteo}</span>
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" title="Aprobar — pasa a Agrupaciones para agendarla en grupo"
                      onClick={() => accion(r, 'aprobar')}
                      disabled={!canGestion || acting === r.academicaId + 'aprobar'}
                      className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 disabled:opacity-40 disabled:cursor-not-allowed">
                      <CheckCircleIcon className="h-6 w-6" />
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" title="Cancelar nivelación"
                      onClick={() => accion(r, 'cancelar')}
                      disabled={!canGestion || acting === r.academicaId + 'cancelar'}
                      className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed">
                      <XCircleIcon className="h-6 w-6" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function NivelacionesContent() {
  const [tab, setTab] = useState<Tab>('solicitudes')
  const [solCount, setSolCount] = useState<number | null>(null)
  const [agrCount, setAgrCount] = useState<number | null>(null)
  const [penCount, setPenCount] = useState<number | null>(null)

  const tabs: Array<{ id: Tab; label: string; count: number | null }> = [
    { id: 'solicitudes', label: 'Solicitudes', count: solCount },
    { id: 'agrupaciones', label: 'Agrupaciones', count: agrCount },
    { id: 'pendientes', label: 'Pendientes', count: penCount },
    { id: 'historial', label: 'Histórico', count: null },
  ]

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Nivelaciones</h1>
      <p className="text-gray-500 mb-4">El recorrido de una nivelación: la pide el Guía, se aprueba, se agrupa para dictarla y, con la asistencia marcada, pasa al histórico.</p>

      <nav className="flex gap-1 border-b border-gray-200 mb-5 -mb-px">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {t.label}
            {t.count !== null && (
              <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                tab === t.id ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-600'
              }`}>{t.count}</span>
            )}
          </button>
        ))}
      </nav>

      {/* Las pestañas se mantienen montadas (ocultas con `hidden`) para no perder
          filtros ni selección al conmutar entre ellas. */}
      <div className={tab === 'solicitudes' ? '' : 'hidden'}>
        <SolicitudesTab onCount={setSolCount} />
      </div>
      <div className={tab === 'agrupaciones' ? '' : 'hidden'}>
        <NivelacionesAgrupacionesTab onCount={setAgrCount} />
      </div>
      <div className={tab === 'pendientes' ? '' : 'hidden'}>
        <NivelacionesPendientesTab onCount={setPenCount} />
      </div>
      <div className={tab === 'historial' ? '' : 'hidden'}>
        <NivelacionesHistorialTab />
      </div>
    </div>
  )
}

export default function NivelacionesPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={ServicioPermission.NIVELACIONES_VER} showDefaultMessage>
        <NivelacionesContent />
      </PermissionGuard>
    </DashboardLayout>
  )
}
