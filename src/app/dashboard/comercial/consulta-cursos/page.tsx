'use client'

import { useState, useEffect, useMemo } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { ComercialPermission } from '@/types/permissions'
import { usePermissions } from '@/hooks/usePermissions'
import { TIPOS_CURSO } from '@/lib/cursos-campaign'
import { exportToExcel } from '@/lib/export-excel'
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'

type Estado = 'matricula' | 'activo' | 'cerrado'
const ESTADO_META: Record<Estado, { label: string; cls: string }> = {
  matricula: { label: 'En matrícula', cls: 'bg-blue-100 text-blue-700' },
  activo:    { label: 'Activo',       cls: 'bg-green-100 text-green-700' },
  cerrado:   { label: 'Cerrado',      cls: 'bg-gray-200 text-gray-700' },
}

export default function ConsultaCursosPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={ComercialPermission.CONSULTA_CURSOS} showDefaultMessage>
        <ConsultaCursosContent />
      </PermissionGuard>
    </DashboardLayout>
  )
}

function ConsultaCursosContent() {
  const { hasPermission } = usePermissions()
  const canExport = hasPermission(ComercialPermission.CONSULTA_CURSOS_EXPORTAR)

  const [rows, setRows] = useState<any[]>([])
  const [guias, setGuias] = useState<{ _id: string; nombreCompleto: string }[]>([])
  const [loading, setLoading] = useState(true)

  // Filtros: inputs (draft) + snapshot aplicado
  const [fCampana, setFCampana] = useState('')
  const [fEstado, setFEstado] = useState<'todos' | Estado>('todos')
  const [fCurso, setFCurso] = useState('')
  const [fDesde, setFDesde] = useState('')
  const [fHasta, setFHasta] = useState('')
  const [applied, setApplied] = useState<{ campana: string; estado: 'todos' | Estado; curso: string; desde: string; hasta: string }>(
    { campana: '', estado: 'todos', curso: '', desde: '', hasta: '' }
  )

  useEffect(() => {
    fetch('/api/postgres/cursos-campaign')
      .then(r => (r.ok ? r.json() : { rows: [] }))
      .then(d => setRows(Array.isArray(d.rows) ? d.rows : []))
      .catch(() => {})
      .finally(() => setLoading(false))
    fetch('/api/postgres/guias')
      .then(r => (r.ok ? r.json() : { guias: [] }))
      .then(d => setGuias(Array.isArray(d.guias) ? d.guias : []))
      .catch(() => {})
  }, [])

  const guiaNombre = (id: any) => {
    if (!id) return '—'
    const g = guias.find(x => x._id === id)
    return g ? g.nombreCompleto : String(id)
  }

  const todayStr = new Date().toLocaleDateString('en-CA')
  const rowEstado = (r: any): Estado => {
    const fc = r.finalCurso ? String(r.finalCurso).slice(0, 10) : ''
    const fcamp = r.finalCampaign ? String(r.finalCampaign).slice(0, 10) : ''
    if (fc && fc < todayStr) return 'cerrado'          // el curso ya terminó
    if (fcamp && fcamp >= todayStr) return 'matricula' // matrícula aún abierta
    return 'activo'                                    // matrícula cerrada, curso en progreso
  }

  const campanas = useMemo(() => Array.from(new Set(rows.map(r => r.campaign).filter(Boolean))).sort(), [rows])

  const filtered = useMemo(() => rows.filter(r => {
    if (applied.campana && String(r.campaign) !== applied.campana) return false
    if (applied.curso && String(r.tipoCurso) !== applied.curso) return false
    if (applied.estado !== 'todos' && rowEstado(r) !== applied.estado) return false
    const ini = r.inicioCurso ? String(r.inicioCurso).slice(0, 10) : ''
    if (applied.desde && (!ini || ini < applied.desde)) return false
    if (applied.hasta && (!ini || ini > applied.hasta)) return false
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, applied, guias])

  const aplicar = () => setApplied({ campana: fCampana, estado: fEstado, curso: fCurso, desde: fDesde, hasta: fHasta })
  const limpiar = () => { setFCampana(''); setFEstado('todos'); setFCurso(''); setFDesde(''); setFHasta(''); setApplied({ campana: '', estado: 'todos', curso: '', desde: '', hasta: '' }) }

  const d = (v: any) => (v ? String(v).slice(0, 10) : '—')

  const handleCSV = () => {
    exportToExcel(filtered, [
      { header: 'Campaña', accessor: (r: any) => r.campaign },
      { header: 'Curso', accessor: (r: any) => r.tipoCurso },
      { header: 'Salón', accessor: (r: any) => r.salon || '' },
      { header: 'Guía', accessor: (r: any) => guiaNombre(r.guia) },
      { header: 'Horario', accessor: (r: any) => r.horarioCurso },
      { header: 'Inscritos', accessor: (r: any) => r.usuInscritos ?? 0 },
      { header: 'Cupos', accessor: (r: any) => r.numeroUsuarios ?? 0 },
      { header: 'Ocupación', accessor: (r: any) => `${r.usuInscritos ?? 0}/${r.numeroUsuarios ?? 0}` },
      { header: 'Estado', accessor: (r: any) => ESTADO_META[rowEstado(r)].label },
      { header: 'Inicio curso', accessor: (r: any) => d(r.inicioCurso) },
      { header: 'Final curso', accessor: (r: any) => d(r.finalCurso) },
      { header: 'Cierre matrícula', accessor: (r: any) => d(r.finalCampaign) },
    ], `consulta_cursos_${todayStr}`)
  }

  const selCls = 'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500'

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Consulta de Cursos</h1>
        <p className="mt-2 text-gray-600">Cursos de campaña: inscritos/cupos, estado y horarios (solo lectura).</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        {/* Filtros */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Campaña</label>
            <select value={fCampana} onChange={e => setFCampana(e.target.value)} className={selCls} title="Campaña">
              <option value="">Todas</option>
              {campanas.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
            <select value={fEstado} onChange={e => setFEstado(e.target.value as any)} className={selCls} title="Estado">
              <option value="todos">Todos</option>
              <option value="matricula">En matrícula</option>
              <option value="activo">Activo</option>
              <option value="cerrado">Cerrado</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Curso</label>
            <select value={fCurso} onChange={e => setFCurso(e.target.value)} className={selCls} title="Tipo de curso">
              <option value="">Todos</option>
              {TIPOS_CURSO.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha inicial (inicio ≥)</label>
            <input type="date" value={fDesde} onChange={e => setFDesde(e.target.value)} className={selCls} title="Inicio de curso desde" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha final (inicio ≤)</label>
            <input type="date" value={fHasta} onChange={e => setFHasta(e.target.value)} className={selCls} title="Inicio de curso hasta" />
          </div>
        </div>

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button type="button" onClick={aplicar} className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700">Aplicar filtros</button>
            <button type="button" onClick={limpiar} className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">Limpiar filtros</button>
            <p className="ml-2 text-sm text-gray-500">{filtered.length} curso(s)</p>
          </div>
          {canExport && filtered.length > 0 && (
            <button type="button" onClick={handleCSV} className="inline-flex items-center px-3 py-2 text-sm font-medium rounded-md border border-green-200 bg-green-100 text-green-700 hover:bg-green-200">
              <ArrowDownTrayIcon className="h-4 w-4 mr-1" /> Descargar CSV
            </button>
          )}
        </div>

        {loading ? (
          <p className="text-gray-500 text-sm">Cargando...</p>
        ) : filtered.length === 0 ? (
          <p className="text-gray-500 text-sm">No hay cursos que coincidan con los filtros.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap [&_th]:font-medium">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2">Campaña</th><th>Curso</th><th>Salón</th><th>Guía</th><th>Horario</th><th>Inscritos</th><th>Estado</th><th>Inicio curso</th><th>Final curso</th><th>Cierre matríc.</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r: any, i: number) => {
                  const full = (r.usuInscritos ?? 0) >= (r.numeroUsuarios ?? 0) && (r.numeroUsuarios ?? 0) > 0
                  const est = rowEstado(r)
                  return (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 font-medium">{r.campaign}</td>
                      <td>{r.tipoCurso}</td>
                      <td>{r.salon || '—'}</td>
                      <td>{guiaNombre(r.guia)}</td>
                      <td>{r.horarioCurso}</td>
                      <td>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${full ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                          {r.usuInscritos ?? 0}/{r.numeroUsuarios ?? 0}
                        </span>
                      </td>
                      <td>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ESTADO_META[est].cls}`}>{ESTADO_META[est].label}</span>
                      </td>
                      <td>{d(r.inicioCurso)}</td>
                      <td>{d(r.finalCurso)}</td>
                      <td>{d(r.finalCampaign)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
