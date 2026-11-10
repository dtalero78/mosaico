'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { AcademicoPermission } from '@/types/permissions'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { exportToExcel } from '@/lib/export-excel'
import {
  MarcoPagina, Campo, SelectFiltro, BotonesConsulta, AvisoSinConsulta, Efectivos, inputCls, tablaCls, thCls, tdCls,
} from '@/components/gestion-cursos/Comunes'

interface Curso {
  cursoId: string; campaign: string; curso: string; salon: string | null; horarioCurso: string
  guia: string | null; inicial: number; conCupo: number; enCierre: number; efectivos: number; cancelados: number
  completo: boolean
}
interface Opciones { campanias: string[]; cursos: string[]; salones: string[]; guias: Array<{ id: string; nombre: string }> }

type Pestania = 'completos' | 'cambio'

export default function SeguimientoCursosPage() {
  const [tab, setTab] = useState<Pestania>('completos')
  const [campaign, setCampaign] = useState('')
  const [curso, setCurso] = useState('')
  const [salon, setSalon] = useState('')
  const [guia, setGuia] = useState('')
  /** '' = todos los que han disminuido; '1'..'8' = exactamente ese número de efectivos. */
  const [numero, setNumero] = useState('')
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
      if (campaign) qs.set('campaign', campaign)
      if (curso) qs.set('curso', curso)
      if (salon) qs.set('salon', salon)
      if (guia) qs.set('guia', guia)
      const j = await fetch(`/api/postgres/gestion-cursos/cursos?${qs}`, { cache: 'no-store' }).then(r => r.json())
      if (j.error) throw new Error(j.error)
      setFilas(j.filas || [])
    } catch (e: any) {
      toast.error(e?.message || 'Error al consultar'); setFilas(null)
    } finally { setCargando(false) }
  }
  const limpiar = () => { setCampaign(''); setCurso(''); setSalon(''); setGuia(''); setNumero(''); setFilas(null) }

  const completos = useMemo(() => (filas || []).filter(f => f.completo), [filas])
  const cambio = useMemo(() => (filas || []).filter(f => !f.completo)
    .filter(f => !numero || f.efectivos === Number(numero))
    .sort((a, b) => a.efectivos - b.efectivos), [filas, numero])
  const lista = tab === 'completos' ? completos : cambio

  const csv = () => lista.length && exportToExcel(lista, [
    { header: 'Campaña', accessor: r => r.campaign }, { header: 'Curso', accessor: r => r.curso },
    { header: 'Salón', accessor: r => r.salon || '' }, { header: 'Guía', accessor: r => r.guia || '' },
    { header: 'Inicial', accessor: r => r.inicial }, { header: 'Con cupo', accessor: r => r.conCupo },
    { header: 'Alumnos (efectivos)', accessor: r => r.efectivos },
  ], `seguimiento_${tab}`, { separator: ';' })

  return (
    <MarcoPagina permiso={AcademicoPermission.GESTION_CURSOS_SEGUIMIENTO} titulo="Seguimiento Cursos"
      descripcion="Cursos vigentes que ya empezaron. Completos: conservan los alumnos con que empezaron. Con Cambio: los redujeron. Con 3 alumnos o menos no son rentables y deben reagruparse.">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <SelectFiltro id="sc-campania" label="Campaña" valor={campaign} onChange={setCampaign} opciones={opciones.campanias} todos="Todas" />
          <SelectFiltro id="sc-curso" label="Curso" valor={curso} onChange={setCurso} opciones={opciones.cursos} todos="Todos" />
          <SelectFiltro id="sc-salon" label="Salón" valor={salon} onChange={setSalon} opciones={opciones.salones} todos="Todos" />
          <SelectFiltro id="sc-guia" label="Guía" valor={guia} onChange={setGuia} opciones={opciones.guias} todos="Todos" />
          {tab === 'cambio' && (
            <Campo id="sc-numero" label="Número de estudiantes (actual)">
              <select id="sc-numero" value={numero} onChange={e => setNumero(e.target.value)} className={inputCls}>
                <option value="">Todos los que han disminuido</option>
                {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </Campo>
          )}
        </div>
        <BotonesConsulta cargando={cargando} onConsultar={consultar} onLimpiar={limpiar}
          exportar={filas && lista.length > 0 ? (
            <PermissionGuard permission={AcademicoPermission.GESTION_CURSOS_EXPORTAR}>
              <button type="button" onClick={csv}
                className="px-4 py-2 text-sm bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md hover:bg-emerald-100">Exportar CSV</button>
            </PermissionGuard>
          ) : null} />
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        {([['completos', 'Completos'], ['cambio', 'Con Cambio']] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === id ? 'border-primary-700 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}{filas ? ` (${id === 'completos' ? completos.length : (filas.filter(f => !f.completo).length)})` : ''}
          </button>
        ))}
      </div>

      {filas === null ? <AvisoSinConsulta /> : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          {lista.length === 0 ? <p className="p-8 text-center text-sm text-gray-500">No hay cursos con esos filtros.</p> : (
            <table className={tablaCls}>
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className={thCls}>Campaña</th><th className={thCls}>Curso</th><th className={thCls}>Salón</th><th className={thCls}>Guía</th>
                  {tab === 'cambio' && <th className={`${thCls} text-center`}>Inicial</th>}
                  <th className={`${thCls} text-center`}>{tab === 'cambio' ? 'Actual' : 'N.º alumnos'}</th>
                </tr>
              </thead>
              <tbody>
                {lista.map(f => (
                  <tr key={f.cursoId} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className={tdCls}>{f.campaign}</td><td className={`${tdCls} font-medium`}>{f.curso}</td>
                    <td className={tdCls}>{f.salon || '—'}</td><td className={tdCls}>{f.guia || '—'}</td>
                    {tab === 'cambio' && <td className={`${tdCls} text-center tabular-nums`}>{f.inicial}</td>}
                    <td className={`${tdCls} text-center`}><Efectivos n={f.efectivos} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </MarcoPagina>
  )
}
