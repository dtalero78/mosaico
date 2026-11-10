'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { AcademicoPermission } from '@/types/permissions'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { exportToExcel } from '@/lib/export-excel'
import {
  MarcoPagina, Campo, SelectFiltro, BotonesConsulta, AvisoSinConsulta, Efectivos, EtiquetaEstado, inputCls, tablaCls, thCls, tdCls,
} from '@/components/gestion-cursos/Comunes'

interface Curso {
  cursoId: string; campaign: string; curso: string; salon: string | null; horarioCurso: string
  guiaId: string | null; guia: string | null; inicial: number; conCupo: number; enCierre: number
  efectivos: number; cancelados: number; completo: boolean; fusion: boolean
}
interface Opciones { campanias: string[]; cursos: string[]; salones: string[]; guias: Array<{ id: string; nombre: string }> }

export default function CursoGuiaPage() {
  const [guia, setGuia] = useState('')
  const [estado, setEstado] = useState('')           // '' | 'completo' | 'disminuido'
  const [campaign, setCampaign] = useState('')
  const [curso, setCurso] = useState('')
  const [opciones, setOpciones] = useState<Opciones>({ campanias: [], cursos: [], salones: [], guias: [] })
  const [filas, setFilas] = useState<Curso[] | null>(null)
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    fetch('/api/postgres/gestion-cursos/cursos?soloOpciones=1', { cache: 'no-store' })
      .then(r => r.json()).then(j => { if (j.opciones) setOpciones(j.opciones) }).catch(() => {})
  }, [])

  const consultar = async () => {
    setCargando(true)
    try {
      const qs = new URLSearchParams()
      if (guia) qs.set('guia', guia)
      if (campaign) qs.set('campaign', campaign)
      if (curso) qs.set('curso', curso)
      const j = await fetch(`/api/postgres/gestion-cursos/cursos?${qs}`, { cache: 'no-store' }).then(r => r.json())
      if (j.error) throw new Error(j.error)
      setFilas(j.filas || [])
    } catch (e: any) {
      toast.error(e?.message || 'Error al consultar'); setFilas(null)
    } finally { setCargando(false) }
  }
  const limpiar = () => { setGuia(''); setEstado(''); setCampaign(''); setCurso(''); setFilas(null) }

  const visibles = useMemo(() => (filas || []).filter(f =>
    !estado || (estado === 'completo' ? f.completo : !f.completo)), [filas, estado])

  // Una agrupación por guía, con el resumen que permite comparar guías entre sí.
  const grupos = useMemo(() => {
    const m = new Map<string, { nombre: string; cursos: Curso[] }>()
    for (const f of visibles) {
      const k = f.guiaId || '__sin__'
      if (!m.has(k)) m.set(k, { nombre: f.guia || '(Sin guía)', cursos: [] })
      m.get(k)!.cursos.push(f)
    }
    return Array.from(m.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [visibles])

  const csv = () => visibles.length && exportToExcel(visibles, [
    { header: 'Guía', accessor: r => r.guia || '' }, { header: 'Campaña', accessor: r => r.campaign },
    { header: 'Curso', accessor: r => r.curso }, { header: 'Salón', accessor: r => r.salon || '' },
    { header: 'Horario', accessor: r => r.horarioCurso }, { header: 'Inicial', accessor: r => r.inicial },
    { header: 'Con cupo', accessor: r => r.conCupo }, { header: 'Efectivos', accessor: r => r.efectivos },
    { header: 'Retirados (en proceso)', accessor: r => r.enCierre }, { header: 'Cancelados', accessor: r => r.cancelados },
    { header: 'Estado', accessor: r => (r.completo ? 'Completo' : 'Disminuido') },
    { header: 'Candidato a fusión', accessor: r => (r.fusion ? 'Sí' : 'No') },
  ], 'curso_guia', { separator: ';' })

  return (
    <MarcoPagina permiso={AcademicoPermission.GESTION_CURSOS_CURSO_GUIA} titulo="Curso Guía"
      descripcion="Los cursos de cada guía con su número de alumnos, para detectar desbalance entre guías y cursos a fusionar (3 alumnos o menos no es rentable).">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <SelectFiltro id="cg-guia" label="Guía" valor={guia} onChange={setGuia} opciones={opciones.guias} todos="Todos" />
          <Campo id="cg-estado" label="Estado">
            <select id="cg-estado" value={estado} onChange={e => setEstado(e.target.value)} className={inputCls}>
              <option value="">Todos</option><option value="completo">Completo</option><option value="disminuido">Disminuido</option>
            </select>
          </Campo>
          <SelectFiltro id="cg-campania" label="Campaña" valor={campaign} onChange={setCampaign} opciones={opciones.campanias} todos="Todas" />
          <SelectFiltro id="cg-curso" label="Curso" valor={curso} onChange={setCurso} opciones={opciones.cursos} todos="Todos" />
        </div>
        <BotonesConsulta cargando={cargando} onConsultar={consultar} onLimpiar={limpiar}
          exportar={filas && visibles.length > 0 ? (
            <PermissionGuard permission={AcademicoPermission.GESTION_CURSOS_EXPORTAR}>
              <button type="button" onClick={csv}
                className="px-4 py-2 text-sm bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md hover:bg-emerald-100">Exportar CSV</button>
            </PermissionGuard>
          ) : null} />
      </div>

      {filas === null ? <AvisoSinConsulta /> : grupos.length === 0 ? (
        <p className="p-8 text-center text-sm text-gray-500 bg-white rounded-xl border border-gray-200">No hay cursos con esos filtros.</p>
      ) : (
        <div className="space-y-4">
          {grupos.map(g => {
            const total = g.cursos.reduce((s, c) => s + c.efectivos, 0)
            const prom = g.cursos.length ? (total / g.cursos.length).toFixed(1) : '0'
            return (
              <div key={g.nombre} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-gray-900">{g.nombre}</h2>
                  <p className="text-xs text-gray-600">
                    {g.cursos.length} curso(s) · <strong>{total}</strong> alumnos efectivos · promedio <strong>{prom}</strong> por curso
                  </p>
                </div>
                <table className={tablaCls}>
                  <thead>
                    <tr>
                      <th className={thCls}>Campaña</th><th className={thCls}>Curso</th><th className={thCls}>Salón</th><th className={thCls}>Horario</th>
                      <th className={`${thCls} text-center`}>Inicial</th><th className={`${thCls} text-center`}>Con cupo</th>
                      <th className={`${thCls} text-center`}>Efectivos</th>
                      <th className={`${thCls} text-center`} title="En proceso de cierre con Finanzas: dejaron de asistir pero aún ocupan cupo">Retirados</th>
                      <th className={`${thCls} text-center`} title="Contrato devuelto, rechazado o anulado">Cancelados</th>
                      <th className={thCls}>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.cursos.map(c => (
                      <tr key={c.cursoId} className={`border-t border-gray-50 ${c.fusion ? 'bg-red-50/40' : ''}`}>
                        <td className={tdCls}>{c.campaign}</td><td className={`${tdCls} font-medium`}>{c.curso}</td>
                        <td className={tdCls}>{c.salon || '—'}</td><td className={`${tdCls} text-xs text-gray-600`}>{c.horarioCurso}</td>
                        <td className={`${tdCls} text-center tabular-nums`}>{c.inicial}</td>
                        <td className={`${tdCls} text-center tabular-nums`}>{c.conCupo}</td>
                        <td className={`${tdCls} text-center`}><Efectivos n={c.efectivos} /></td>
                        <td className={`${tdCls} text-center tabular-nums`}>{c.enCierre}</td>
                        <td className={`${tdCls} text-center tabular-nums`}>{c.cancelados}</td>
                        <td className={tdCls}>
                          <EtiquetaEstado completo={c.completo} />
                          {c.fusion && <span className="ml-2 text-[10px] font-semibold text-red-700">Candidato a fusión</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}
    </MarcoPagina>
  )
}
