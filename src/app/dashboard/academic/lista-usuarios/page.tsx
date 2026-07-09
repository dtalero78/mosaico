'use client'

import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { exportToExcel } from '@/lib/export-excel'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { AcademicoPermission } from '@/types/permissions'
import { TIPOS_CURSO } from '@/lib/cursos-campaign'

interface Row {
  nombre: string
  curso: string | null
  fechaNacimiento: string | null
  edad: number | null
  apoderado: string | null
  guia: string | null
  modulo: string | null
  leccion: string | null
}
interface Guia { id: string; nombre: string }

function ListaUsuariosContent() {
  const [campaign, setCampaign] = useState('')
  const [curso, setCurso] = useState('')
  const [salon, setSalon] = useState('')
  const [guia, setGuia] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const [rows, setRows] = useState<Row[]>([])
  const [campanias, setCampanias] = useState<string[]>([])
  const [salones, setSalones] = useState<string[]>([])
  const [guias, setGuias] = useState<Guia[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async (f?: { campaign?: string; curso?: string; salon?: string; guia?: string; startDate?: string; endDate?: string }) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (f?.campaign)  qs.set('campaign', f.campaign)
      if (f?.curso)     qs.set('curso', f.curso)
      if (f?.salon)     qs.set('salon', f.salon)
      if (f?.guia)      qs.set('guia', f.guia)
      if (f?.startDate) qs.set('startDate', f.startDate)
      if (f?.endDate)   qs.set('endDate', f.endDate)
      const r = await fetch(`/api/postgres/reports/academico/lista-usuarios?${qs}`, { cache: 'no-store' }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      setRows(r.rows || [])
      setCampanias(r.campanias || [])
      setSalones(r.salones || [])
      setGuias(r.guias || [])
    } catch (e: any) {
      toast.error(e?.message || 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const aplicar = () => fetchData({ campaign, curso, salon, guia, startDate, endDate })
  const borrar = () => {
    setCampaign(''); setCurso(''); setSalon(''); setGuia(''); setStartDate(''); setEndDate('')
    fetchData()
  }
  const exportar = () => {
    exportToExcel(rows, [
      { header: 'Nombre', accessor: r => r.nombre },
      { header: 'Curso', accessor: r => r.curso || '' },
      { header: 'Fecha nacimiento', accessor: r => r.fechaNacimiento || '' },
      { header: 'Edad', accessor: r => (r.edad ?? '') },
      { header: 'Apoderado', accessor: r => r.apoderado || '' },
      { header: 'Guía', accessor: r => r.guia || '' },
      { header: 'Módulo', accessor: r => r.modulo || '' },
      { header: 'Lección', accessor: r => r.leccion || '' },
    ], 'lista-usuarios')
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Lista de Usuarios</h1>
      <p className="text-gray-500 mb-5">Estudiantes por campaña, curso, salón y guía. Total: <span className="font-semibold text-gray-700">{rows.length}</span></p>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Campaña</label>
            <select value={campaign} onChange={e => setCampaign(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todas</option>
              {campanias.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Curso</label>
            <select value={curso} onChange={e => setCurso(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>
              {TIPOS_CURSO.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Salón</label>
            <select value={salon} onChange={e => setSalon(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>
              {salones.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Guía</label>
            <select value={guia} onChange={e => setGuia(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>
              {guias.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
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
          <PermissionGuard permission={AcademicoPermission.LISTA_USUARIOS_EXPORTAR}>
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
                {['Nombre', 'Curso', 'Fecha nacimiento', 'Edad', 'Apoderado', 'Guía', 'Módulo', 'Lección'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">Cargando…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">Sin resultados</td></tr>
              ) : rows.map((r, idx) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{r.nombre || '—'}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.curso || '—'}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.fechaNacimiento || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{r.edad ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{r.apoderado || '—'}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.guia || '—'}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.modulo || '—'}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.leccion || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default function ListaUsuariosPage() {
  return (
    <PermissionGuard permission={AcademicoPermission.LISTA_USUARIOS_VER} showDefaultMessage>
      <ListaUsuariosContent />
    </PermissionGuard>
  )
}
