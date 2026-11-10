'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { AcademicoPermission } from '@/types/permissions'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { exportToExcel } from '@/lib/export-excel'
import { hoyEnChile } from '@/lib/cursos-campaign'
import {
  MarcoPagina, Campo, SelectFiltro, BotonesConsulta, AvisoSinConsulta, inputCls, tablaCls, thCls, tdCls,
} from '@/components/gestion-cursos/Comunes'

interface Fila {
  academicaId: string; campaign: string | null; curso: string | null; salon: string | null
  contrato: string | null; numeroId: string | null; nombre: string; guia: string | null
  ausencias: number; ultima: string | null
}
interface Opciones { campanias: string[]; cursos: string[]; salones: string[]; guias: Array<{ id: string; nombre: string }> }

/** Últimos 30 días, hasta hoy (hora de Chile). */
function periodoPorDefecto() {
  const hasta = hoyEnChile()
  const d = new Date(`${hasta}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 30)
  return { desde: d.toISOString().slice(0, 10), hasta }
}

const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export default function AusenciasPage() {
  const def = periodoPorDefecto()
  const [usuario, setUsuario] = useState('')
  const [campaign, setCampaign] = useState('')
  const [curso, setCurso] = useState('')
  const [salon, setSalon] = useState('')
  const [guia, setGuia] = useState('')
  const [desde, setDesde] = useState(def.desde)
  const [hasta, setHasta] = useState(def.hasta)
  const [opciones, setOpciones] = useState<Opciones>({ campanias: [], cursos: [], salones: [], guias: [] })
  const [rows, setRows] = useState<Fila[] | null>(null)
  const [cargando, setCargando] = useState(false)

  // Sólo los menús de filtro (consulta liviana); la consulta de ausencias espera el botón.
  useEffect(() => {
    fetch('/api/postgres/gestion-cursos/ausencias?soloOpciones=1', { cache: 'no-store' })
      .then(r => r.json()).then(j => { if (j.opciones) setOpciones(j.opciones) }).catch(() => {})
  }, [])

  const consultar = async () => {
    setCargando(true)
    try {
      const qs = new URLSearchParams({ startDate: desde, endDate: hasta })
      if (usuario.trim()) qs.set('usuario', usuario.trim())
      if (campaign) qs.set('campaign', campaign)
      if (curso) qs.set('curso', curso)
      if (salon) qs.set('salon', salon)
      if (guia) qs.set('guia', guia)
      const j = await fetch(`/api/postgres/gestion-cursos/ausencias?${qs}`, { cache: 'no-store' }).then(r => r.json())
      if (j.error) throw new Error(j.error)
      setRows(j.rows || [])
    } catch (e: any) {
      toast.error(e?.message || 'Error al consultar'); setRows(null)
    } finally { setCargando(false) }
  }
  const limpiar = () => {
    setUsuario(''); setCampaign(''); setCurso(''); setSalon(''); setGuia('')
    const p = periodoPorDefecto(); setDesde(p.desde); setHasta(p.hasta); setRows(null)
  }
  const csv = () => rows && exportToExcel(rows, [
    { header: 'Curso', accessor: r => r.curso || '' }, { header: 'Nombre', accessor: r => r.nombre },
    { header: 'Contrato', accessor: r => r.contrato || '' }, { header: 'ID', accessor: r => r.numeroId || '' },
    { header: 'Campaña', accessor: r => r.campaign || '' }, { header: 'Salón', accessor: r => r.salon || '' },
    { header: 'Guía', accessor: r => r.guia || '' },
    { header: 'Ausencias sin justificar', accessor: r => r.ausencias }, { header: 'Última ausencia', accessor: r => fmt(r.ultima) },
  ], `ausencias_${desde}_${hasta}`, { separator: ';' })

  return (
    <MarcoPagina permiso={AcademicoPermission.GESTION_CURSOS_AUSENCIAS} titulo="Ausencias"
      descripcion="Alumnos con 2 o más ausencias sin justificar en el período. Las justificadas no cuentan; un sábado de dos lecciones cuenta dos.">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Campo id="au-usuario" label="Nombre, ID o contrato">
            <input id="au-usuario" value={usuario} onChange={e => setUsuario(e.target.value)} placeholder="Nombre, documento o contrato"
              className={inputCls} onKeyDown={e => { if (e.key === 'Enter') consultar() }} />
          </Campo>
          <SelectFiltro id="au-campania" label="Campaña" valor={campaign} onChange={setCampaign} opciones={opciones.campanias} todos="Todas" />
          <SelectFiltro id="au-curso" label="Curso" valor={curso} onChange={setCurso} opciones={opciones.cursos} todos="Todos" />
          <SelectFiltro id="au-salon" label="Salón" valor={salon} onChange={setSalon} opciones={opciones.salones} todos="Todos" />
          <SelectFiltro id="au-guia" label="Guía" valor={guia} onChange={setGuia} opciones={opciones.guias} todos="Todos" />
          <Campo id="au-desde" label="Fecha inicial">
            <input id="au-desde" type="date" value={desde} onChange={e => setDesde(e.target.value)} className={inputCls} />
          </Campo>
          <Campo id="au-hasta" label="Fecha final">
            <input id="au-hasta" type="date" value={hasta} onChange={e => setHasta(e.target.value)} className={inputCls} />
          </Campo>
        </div>
        <p className="text-xs text-gray-400 mt-3">Por defecto abre con los últimos 30 días, hasta hoy.</p>
        <BotonesConsulta cargando={cargando} onConsultar={consultar} onLimpiar={limpiar}
          exportar={rows && rows.length > 0 ? (
            <PermissionGuard permission={AcademicoPermission.GESTION_CURSOS_EXPORTAR}>
              <button type="button" onClick={csv}
                className="px-4 py-2 text-sm bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md hover:bg-emerald-100">Exportar CSV</button>
            </PermissionGuard>
          ) : null} />
      </div>

      {rows === null ? <AvisoSinConsulta /> : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <div className="px-4 py-2 text-sm text-gray-600 border-b border-gray-100">
            Alumnos con 2 o más ausencias sin justificar: <strong>{rows.length}</strong>
          </div>
          {rows.length === 0 ? <p className="p-8 text-center text-sm text-gray-500">Ningún alumno cumple en el período.</p> : (
            <table className={tablaCls}>
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className={thCls}>Curso / Nombre</th><th className={thCls}>Contrato</th><th className={thCls}>ID</th>
                  <th className={thCls}>Salón</th><th className={thCls}>Guía</th>
                  <th className={`${thCls} text-center`}>Ausencias sin justificar</th><th className={thCls}>Última ausencia</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.academicaId} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className={tdCls}>
                      <div className="text-[11px] text-gray-500 uppercase">{r.curso || '—'}</div>
                      <a href={`/student/${r.academicaId}`} target="_blank" rel="noopener noreferrer"
                        className="text-primary-700 hover:underline font-medium">{r.nombre}</a>
                    </td>
                    <td className={tdCls}>{r.contrato || '—'}</td>
                    <td className={`${tdCls} tabular-nums`}>{r.numeroId || '—'}</td>
                    <td className={tdCls}>{r.salon || '—'}</td>
                    <td className={tdCls}>{r.guia || '—'}</td>
                    <td className={`${tdCls} text-center`}>
                      <span className={`inline-flex min-w-[2rem] justify-center text-xs font-bold px-2 py-0.5 rounded-full ${r.ausencias >= 4 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>{r.ausencias}</span>
                    </td>
                    <td className={tdCls}>{fmt(r.ultima)}</td>
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
