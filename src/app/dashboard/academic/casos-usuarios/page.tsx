'use client'

import { useCallback, useEffect, useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { AcademicoPermission } from '@/types/permissions'
import { exportToExcel } from '@/lib/export-excel'
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'

/**
 * Académico › Casos Usuarios — listado de los Casos de Atención.
 *
 * El detalle y la gestión viven en la ficha del alumno; desde aquí se entra al
 * caso. El rol GUIA sólo ve los casos que él reportó, y eso lo decide el
 * servidor, no esta pantalla.
 */

const ESTADO_LABEL: Record<string, string> = {
  EN_GESTION: 'En gestión', RESUELTO: 'Resuelto', PROCESO_DE_CIERRE: 'Proceso de cierre',
  PROPUESTA_DE_CAMBIO: 'Propuesta de cambio', CIERRA_PROGRAMA: 'Cierra programa',
  REMITIDO_A_ACADEMICA: 'Remitido a Académica', PROGRAMA_CONGELADO: 'Programa congelado',
  PRE_JURIDICO: 'Pre-jurídico', SIN_CONTACTO: 'Sin contacto',
}
const TEMA_LABEL: Record<string, string> = {
  ASISTENCIA: 'Asistencia', CONDUCTA: 'Conducta', DESEMPENO: 'Desempeño',
  SALUD: 'Salud', PAGO: 'Pago', OTRO: 'Otro',
}
const REINCIDENCIA_COLOR: Record<string, string> = {
  BAJA: 'bg-emerald-100 text-emerald-700', MEDIA: 'bg-amber-100 text-amber-700', ALTA: 'bg-red-100 text-red-700',
}

const fmt = (v: any) => v
  ? new Date(v).toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'short', year: 'numeric' })
  : '—'

export default function CasosUsuariosPage() {
  const [rows, setRows] = useState<any[]>([])
  const [meta, setMeta] = useState<any>({})
  const [loading, setLoading] = useState(false)
  const [estado, setEstado] = useState('abiertos')
  const [tema, setTema] = useState('')
  const [curso, setCurso] = useState('')
  const [salon, setSalon] = useState('')
  const [guia, setGuia] = useState('')
  const [q, setQ] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams()
      if (estado) p.set('estado', estado)
      if (tema) p.set('tema', tema)
      if (curso) p.set('curso', curso)
      if (salon) p.set('salon', salon)
      if (guia) p.set('guia', guia)
      if (q.trim()) p.set('q', q.trim())
      const r = await fetch(`/api/postgres/casos-atencion/listado?${p}`, { cache: 'no-store' })
      const j = await r.json()
      if (j?.success) { setRows(j.rows || []); setMeta(j) }
    } finally { setLoading(false) }
  }, [estado, tema, curso, salon, guia, q])

  useEffect(() => { cargar() }, [cargar])

  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.CASOS_USUARIOS_VER} showDefaultMessage>
        <div className="p-6 max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Casos Usuarios</h1>
          <p className="text-gray-500 mb-4">
            Casos de Atención abiertos desde el panel del guía. El detalle y la gestión están en la ficha del alumno.
            {meta.soloMisCasos && <span className="ml-1 text-primary-600">Viendo sólo los casos que reportaste.</span>}
          </p>

          {/* Filtros */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Estado</label>
              <select value={estado} onChange={e => setEstado(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="abiertos">Abiertos</option>
                <option value="cerrados">Cerrados</option>
                <option value="">Todos</option>
                {Object.entries(ESTADO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Tema</label>
              <select value={tema} onChange={e => setTema(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Todos</option>
                {Object.entries(TEMA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Curso</label>
              <select value={curso} onChange={e => setCurso(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Todos</option>
                {(meta.cursos || []).map((c: string) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Salón</label>
              <select value={salon} onChange={e => setSalon(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Todos</option>
                {(meta.salones || []).map((s: string) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {/* Un GUIA sólo ve sus propios casos, así que el filtro no le aporta. */}
            {!meta.soloMisCasos && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Guía</label>
                <select value={guia} onChange={e => setGuia(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="">Todos</option>
                  {(meta.guias || []).map((g: any) => <option key={g._id} value={g._id}>{g.nombre}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Buscar</label>
              <input type="text" value={q} onChange={e => setQ(e.target.value)}
                placeholder="Alumno, contrato o código"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <p className="text-sm text-gray-600">
              {loading ? 'Cargando…' : `${meta.total || 0} caso(s) · ${meta.abiertos || 0} abierto(s)`}
              {meta.sinLeer > 0 && <span className="ml-2 text-red-600 font-medium">{meta.sinLeer} reporte(s) sin leer</span>}
            </p>
            <button type="button" disabled={!rows.length}
              onClick={() => exportToExcel(rows, [
                { header: 'Contrato', accessor: (r: any) => r.contrato || '' },
                { header: 'Código', accessor: (r: any) => r.codigo },
                { header: 'Alumno', accessor: (r: any) => r.alumno || '' },
                { header: 'ID', accessor: (r: any) => r.numeroId || '' },
                { header: 'Curso', accessor: (r: any) => r.curso || '' },
                { header: 'Salón', accessor: (r: any) => r.salon || '' },
                { header: 'Guía', accessor: (r: any) => r.guia || '' },
                { header: 'Tema', accessor: (r: any) => TEMA_LABEL[r.tema] || r.tema },
                { header: 'Estado', accessor: (r: any) => ESTADO_LABEL[r.estado] || r.estado },
                { header: 'Reportes', accessor: (r: any) => r.reportes },
                { header: 'Reincidencia', accessor: (r: any) => r.reincidenciaNivel || '' },
                { header: 'Abierto', accessor: (r: any) => fmt(r.abiertoEn) },
              ], 'casos-usuarios')}
              className="inline-flex items-center px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              <ArrowDownTrayIcon className="h-4 w-4 mr-1" /> Descargar CSV
            </button>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    {['Contrato', 'Alumno', 'Curso', 'Salón', 'Guía', 'Tema', 'Reportes', 'Reincidencia', 'Estado', 'Abierto'].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr><td colSpan={10} className="px-3 py-10 text-center text-gray-400">Cargando…</td></tr>
                  ) : !rows.length ? (
                    <tr><td colSpan={10} className="px-3 py-10 text-center text-gray-400">
                      No hay casos con estos filtros.
                    </td></tr>
                  ) : rows.map(r => (
                    <tr key={r._id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {/* El contrato es lo que se reconoce a simple vista; el
                            código del caso queda en el tooltip y en el CSV. */}
                        <button type="button"
                          onClick={() => window.open(`/student/${r.academicaId}?tab=casos-atencion`, '_blank', 'noopener,noreferrer')}
                          className="text-primary-600 hover:underline font-medium"
                          title={`Abrir el caso ${r.codigo} en la ficha del alumno`}>
                          {r.contrato || r.codigo}
                        </button>
                        {r.sinLeer > 0 && (
                          <span className="ml-1 inline-block w-2 h-2 rounded-full bg-red-500 align-middle"
                            title={`${r.sinLeer} reporte(s) sin leer`} />
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-800 whitespace-nowrap">
                        {r.alumno || '—'}
                        {r.numeroId && <span className="block text-xs text-gray-400">{r.numeroId}</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{r.curso || '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{r.salon || '—'}</td>
                      <td className="px-3 py-2 text-gray-600">
                        <span className="block max-w-[150px] truncate" title={r.guia || ''}>{r.guia || '—'}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">
                          {TEMA_LABEL[r.tema] || r.tema}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-700">{r.reportes}</td>
                      <td className="px-3 py-2">
                        {r.reincidenciaNivel ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${REINCIDENCIA_COLOR[r.reincidenciaNivel]}`}>
                            {r.reincidenciaNivel}
                          </span>
                        ) : <span className="text-gray-400 text-xs">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.estado === 'EN_GESTION'
                          ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                          {ESTADO_LABEL[r.estado] || r.estado}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmt(r.abiertoEn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
