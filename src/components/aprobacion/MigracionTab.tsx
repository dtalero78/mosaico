'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle, ChevronLeft, ChevronRight, Download, RefreshCw, AlertCircle } from 'lucide-react'
import { exportToExcel } from '@/lib/export-excel'

/**
 * Pestaña «Migración» del Centro de Aprobaciones.
 *
 * Contratos dados de alta por back-office (Migrar Contrato, Importar PDF, Subir
 * Lote) que siguen sin aprobar. Se marcan y se aprueban en lote: por cada uno el
 * servidor registra la firma si falta, lo deja listo si falta, lo aprueba
 * dejando a cada alumno en su salón (sólo clases futuras), regenera el PDF en
 * Drive y —sólo si se marca la casilla— envía el WhatsApp de bienvenida.
 */

interface Beneficiario {
  _id: string
  nombre: string
  campaign: string | null
  tipoCurso: string | null
  horarioCurso: string | null
  salon: string | null
  aprobacion: string | null
  motivoNoAprobable: string | null
}

interface Contrato {
  _id: string
  primerNombre: string
  primerApellido: string
  segundoApellido: string | null
  numeroId: string
  contrato: string
  plataforma: string | null
  celular: string | null
  email: string | null
  aprobacion: string | null
  firmado: boolean
  listo: boolean
  _createdDate: string
  beneficiarios: Beneficiario[]
}

interface Resultado {
  titularId: string
  contrato: string
  nombre: string
  ok: boolean
  error?: string
  firma?: 'REGISTRADA' | 'YA_ESTABA'
  listo?: 'MARCADO' | 'YA_ESTABA'
  beneficiarios?: Array<{
    nombre: string; aprobado: boolean; salon: string | null; leccion: string | null
    agendamientos: number; whatsapp: 'ENVIADO' | 'NO_ENVIADO' | 'ERROR'; detalle: string | null
  }>
  omitidos?: Array<{ nombre: string; motivo: string }>
  pdf?: { ok: boolean; archivo: string | null; error: string | null }
}

const POR_PAGINA = 15

const ESTADOS = [
  { value: '', label: 'Todos' },
  { value: 'firmado', label: 'Firmado sin aprobar' },
  { value: 'sinFirmar', label: 'Sin firmar' },
  { value: 'faltaListo', label: 'Falta dejar listo' },
]

const cursoSalon = (b: Beneficiario) =>
  [b.tipoCurso, b.salon ? `Salón ${b.salon}` : null].filter(Boolean).join(' · ')

const campanasDe = (c: Contrato) =>
  Array.from(new Set(c.beneficiarios.map(b => b.campaign).filter(Boolean))) as string[]

export default function MigracionTab({ onCount }: { onCount?: (n: number) => void }) {
  const [contratos, setContratos] = useState<Contrato[]>([])
  const [excluidas, setExcluidas] = useState<{ enMatricula: string[]; anterior: string | null; excluidos: number }>({
    enMatricula: [], anterior: null, excluidos: 0,
  })
  const [loading, setLoading] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)

  // Filtros
  const [buscar, setBuscar] = useState('')
  const [estado, setEstado] = useState('')
  const [campaign, setCampaign] = useState('')
  const [curso, setCurso] = useState('')
  const [salon, setSalon] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [pagina, setPagina] = useState(1)

  // Selección y proceso
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [modal, setModal] = useState(false)
  const [enviarWhatsApp, setEnviarWhatsApp] = useState(false)
  const [confirmo, setConfirmo] = useState(false)
  const [progreso, setProgreso] = useState<{ done: number; total: number; actual: string } | null>(null)
  const [resultados, setResultados] = useState<Resultado[] | null>(null)

  const cargar = async () => {
    setLoading(true)
    setErrorCarga(null)
    try {
      const res = await fetch('/api/postgres/approvals/migracion', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.success === false) throw new Error(json?.error || `Error ${res.status}`)
      setContratos(json.contratos || [])
      setExcluidas({ enMatricula: json.enMatricula || [], anterior: json.anterior || null, excluidos: json.excluidos || 0 })
      onCount?.((json.contratos || []).length)
    } catch (e: any) {
      setErrorCarga(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Opciones de los desplegables, sacadas de los propios contratos: así nunca se
  // ofrece una opción que devolvería la lista vacía.
  const opcionesCampana = useMemo(
    () => Array.from(new Set(contratos.flatMap(campanasDe))).sort(),
    [contratos]
  )
  const opcionesCurso = useMemo(
    () => Array.from(new Set(contratos.flatMap(c => c.beneficiarios
      .filter(b => !campaign || b.campaign === campaign)
      .map(b => b.tipoCurso).filter(Boolean)))).sort() as string[],
    [contratos, campaign]
  )
  const opcionesSalon = useMemo(
    () => Array.from(new Set(contratos.flatMap(c => c.beneficiarios
      .filter(b => (!campaign || b.campaign === campaign) && (!curso || b.tipoCurso === curso))
      .map(b => b.salon).filter(Boolean)))).sort() as string[],
    [contratos, campaign, curso]
  )

  const filtrados = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return contratos.filter(c => {
      if (q) {
        const texto = `${c.primerNombre} ${c.primerApellido} ${c.segundoApellido || ''} ${c.contrato}`.toLowerCase()
        if (!texto.includes(q)) return false
      }
      if (estado === 'firmado' && !c.firmado) return false
      if (estado === 'sinFirmar' && c.firmado) return false
      if (estado === 'faltaListo' && c.listo) return false
      // Curso y salón se miran en el MISMO alumno: un contrato con dos hermanos
      // en cursos distintos no debe aparecer por la combinación de los dos.
      if (campaign || curso || salon) {
        const algunAlumno = c.beneficiarios.some(b =>
          (!campaign || b.campaign === campaign) && (!curso || b.tipoCurso === curso) && (!salon || b.salon === salon))
        if (!algunAlumno) return false
      }
      const dia = String(c._createdDate).slice(0, 10)
      if (desde && dia < desde) return false
      if (hasta && dia > hasta) return false
      return true
    })
  }, [contratos, buscar, estado, campaign, curso, salon, desde, hasta])

  useEffect(() => { setPagina(1) }, [buscar, estado, campaign, curso, salon, desde, hasta])

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA))
  const pagina_ = filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)
  const seleccion = contratos.filter(c => marcados.has(c._id))
  const todosVisiblesMarcados = filtrados.length > 0 && filtrados.every(c => marcados.has(c._id))

  const toggle = (id: string) => setMarcados(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const toggleVisibles = () => setMarcados(prev => {
    const n = new Set(prev)
    if (todosVisiblesMarcados) filtrados.forEach(c => n.delete(c._id))
    else filtrados.forEach(c => n.add(c._id))
    return n
  })

  const limpiar = () => {
    setBuscar(''); setEstado(''); setCampaign(''); setCurso(''); setSalon(''); setDesde(''); setHasta('')
  }

  const abrirModal = () => {
    setResultados(null); setProgreso(null); setEnviarWhatsApp(false); setConfirmo(false); setModal(true)
  }

  const aprobar = async () => {
    const lista = seleccion
    const res: Resultado[] = []
    for (let i = 0; i < lista.length; i++) {
      const c = lista[i]
      const nombre = `${c.primerNombre} ${c.primerApellido}`.trim()
      setProgreso({ done: i, total: lista.length, actual: `${nombre} · ${c.contrato}` })
      try {
        const r = await fetch(`/api/postgres/approvals/migracion/${c._id}/aprobar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enviarWhatsApp }),
        })
        const json = await r.json().catch(() => ({}))
        if (!r.ok || json?.success === false) throw new Error(json?.error || `Error ${r.status}`)
        res.push({ ...json.resultado, ok: true })
      } catch (e: any) {
        res.push({ titularId: c._id, contrato: c.contrato, nombre, ok: false, error: e.message })
      }
    }
    setProgreso({ done: lista.length, total: lista.length, actual: '' })
    setResultados(res)

    const okIds = new Set(res.filter(r => r.ok).map(r => r.titularId))
    setContratos(prev => {
      const quedan = prev.filter(c => !okIds.has(c._id))
      onCount?.(quedan.length)
      return quedan
    })
    setMarcados(prev => { const n = new Set(prev); okIds.forEach(id => n.delete(id)); return n })
  }

  const descargarResumen = () => {
    if (!resultados) return
    const filas = resultados.flatMap(r => {
      const base = { contrato: r.contrato, titular: r.nombre, ok: r.ok, error: r.error || '',
        firma: r.firma || '', listo: r.listo || '', pdf: r.pdf ? (r.pdf.ok ? r.pdf.archivo || 'OK' : `Error: ${r.pdf.error}`) : '' }
      const alumnos = [
        ...(r.beneficiarios || []).map(b => ({ ...base, alumno: b.nombre, salon: b.salon || '', leccion: b.leccion || '',
          agendamientos: b.agendamientos, whatsapp: b.whatsapp, nota: b.detalle || '' })),
        ...(r.omitidos || []).map(o => ({ ...base, alumno: o.nombre, salon: '', leccion: '', agendamientos: 0,
          whatsapp: '', nota: `No aprobado: ${o.motivo}` })),
      ]
      return alumnos.length ? alumnos : [{ ...base, alumno: '', salon: '', leccion: '', agendamientos: 0, whatsapp: '', nota: '' }]
    })
    exportToExcel(filas, [
      { header: 'Contrato', accessor: f => f.contrato },
      { header: 'Titular', accessor: f => f.titular },
      { header: 'Resultado', accessor: f => (f.ok ? 'Aprobado' : 'Error') },
      { header: 'Error', accessor: f => f.error },
      { header: 'Firma', accessor: f => (f.firma === 'REGISTRADA' ? 'Registrada ahora' : f.firma ? 'Ya estaba' : '') },
      { header: 'Listo', accessor: f => (f.listo === 'MARCADO' ? 'Marcado ahora' : f.listo ? 'Ya estaba' : '') },
      { header: 'Alumno', accessor: f => f.alumno },
      { header: 'Salón', accessor: f => f.salon },
      { header: 'Lección', accessor: f => f.leccion },
      { header: 'Clases agendadas', accessor: f => f.agendamientos },
      { header: 'WhatsApp', accessor: f => f.whatsapp },
      { header: 'PDF en Drive', accessor: f => f.pdf },
      { header: 'Nota', accessor: f => f.nota },
    ], `migracion-aprobados-${new Date().toISOString().slice(0, 10)}`)
  }

  const enProceso = !!progreso && !resultados

  return (
    <div className="space-y-4">
      {/* Qué se deja fuera y por qué */}
      <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
        Contratos dados de alta por migración que siguen sin aprobar. No se incluyen los de la campaña en matrícula
        {excluidas.enMatricula.length > 0 && <> (<strong>{excluidas.enMatricula.join(', ')}</strong>)</>}
        {' '}ni los de la inmediatamente anterior
        {excluidas.anterior && <> (<strong>{excluidas.anterior}</strong>)</>}
        : esos se aprueban por el flujo normal.
        {excluidas.excluidos > 0 && <> Quedan fuera por esa regla: {excluidas.excluidos}.</>}
      </div>

      {/* Filtros */}
      <div className="card p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-2">
            <label htmlFor="mig-buscar" className="block text-sm font-medium text-gray-700 mb-1">Buscar por apellido, nombre o contrato</label>
            <input id="mig-buscar" type="text" value={buscar} onChange={e => setBuscar(e.target.value)}
              placeholder="Apellido, nombre o contrato…"
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
          <div className="lg:col-span-2">
            <label htmlFor="mig-estado" className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
            <select id="mig-estado" value={estado} onChange={e => setEstado(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
              {ESTADOS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="lg:col-span-2">
            <label htmlFor="mig-campana" className="block text-sm font-medium text-gray-700 mb-1">Campaña</label>
            <select id="mig-campana" value={campaign} onChange={e => { setCampaign(e.target.value); setCurso(''); setSalon('') }}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
              <option value="">Todas</option>
              {opcionesCampana.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="lg:col-span-2">
            <label htmlFor="mig-curso" className="block text-sm font-medium text-gray-700 mb-1">Curso</label>
            <select id="mig-curso" value={curso} onChange={e => { setCurso(e.target.value); setSalon('') }}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
              <option value="">Todos</option>
              {opcionesCurso.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="lg:col-span-1">
            <label htmlFor="mig-salon" className="block text-sm font-medium text-gray-700 mb-1">Salón</label>
            <select id="mig-salon" value={salon} onChange={e => setSalon(e.target.value)}
              className="w-full px-2 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
              <option value="">Todos</option>
              {opcionesSalon.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="lg:col-span-3">
            <span className="block text-sm font-medium text-gray-700 mb-1">Rango de fechas</span>
            <div className="flex gap-2">
              <input type="date" aria-label="Desde" value={desde} onChange={e => setDesde(e.target.value)}
                className="flex-1 min-w-0 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              <input type="date" aria-label="Hasta" value={hasta} onChange={e => setHasta(e.target.value)}
                className="flex-1 min-w-0 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={limpiar} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">
            Borrar filtros
          </button>
          <button type="button" onClick={cargar} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Actualizar
          </button>
        </div>
      </div>

      {/* Encabezado de la tabla */}
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Contratos migrados sin aprobar ({filtrados.length})</h2>
          {seleccion.length > 0 && (
            <button type="button" onClick={abrirModal}
              className="inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700">
              <CheckCircle className="w-4 h-4" /> Aprobar seleccionados ({seleccion.length})
            </button>
          )}
        </div>
        {totalPaginas > 1 && (
          <div className="flex items-center gap-2">
            <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={pagina === 1}
              className="p-2 border rounded-lg disabled:opacity-50 hover:bg-gray-50" aria-label="Página anterior">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 py-1 text-sm">{pagina} de {totalPaginas}</span>
            <button onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} disabled={pagina === totalPaginas}
              className="p-2 border rounded-lg disabled:opacity-50 hover:bg-gray-50" aria-label="Página siguiente">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="card p-12 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Cargando contratos migrados…</p>
        </div>
      ) : errorCarga ? (
        <div className="card p-8 text-center text-red-700">{errorCarga}</div>
      ) : filtrados.length === 0 ? (
        <div className="card p-12 text-center">
          <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">No hay contratos migrados por aprobar</h3>
          <p className="text-gray-500">{contratos.length ? 'Ninguno coincide con los filtros.' : 'Todos los contratos migrados ya están aprobados.'}</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <input type="checkbox" checked={todosVisiblesMarcados} onChange={toggleVisibles}
                      title="Marcar todos los visibles con estos filtros" aria-label="Marcar todos los visibles"
                      className="h-4 w-4 text-primary-600 rounded border-gray-300" />
                  </th>
                  {['Titular', 'Contrato', 'Campaña', 'Curso · Salón', 'Firma', 'Listo', 'Fecha'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {pagina_.map(c => {
                  const sinSalon = c.beneficiarios.length > 0 && c.beneficiarios.every(b => b.motivoNoAprobable)
                  return (
                    <tr key={c._id} className={marcados.has(c._id) ? 'bg-primary-50' : 'hover:bg-gray-50'}>
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={marcados.has(c._id)} onChange={() => toggle(c._id)}
                          aria-label={`Marcar ${c.contrato}`} className="h-4 w-4 text-primary-600 rounded border-gray-300" />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <a href={`/person/${c._id}`} target="_blank" rel="noopener noreferrer"
                          className="text-sm font-medium text-gray-900 hover:text-primary-700 hover:underline">
                          {c.primerNombre} {c.primerApellido}
                        </a>
                        <div className="text-xs text-gray-500">{c.numeroId}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {c.contrato}
                        <div className="text-xs text-gray-500">{c.plataforma}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{campanasDe(c).join(', ') || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {c.beneficiarios.length === 0 ? <span className="text-gray-400">Sin alumnos</span> : (
                          <div className="flex flex-col gap-0.5">
                            {c.beneficiarios.map(b => (
                              <span key={b._id} className="whitespace-nowrap" title={b.motivoNoAprobable || b.horarioCurso || ''}>
                                {b.motivoNoAprobable
                                  ? <span className="text-red-600">{b.nombre}: sin salón</span>
                                  : <>{cursoSalon(b)} <span className="text-gray-400 text-xs">{b.horarioCurso}</span></>}
                              </span>
                            ))}
                            {sinSalon && (
                              <span className="text-[11px] text-red-600">Ningún alumno con salón: no se podrá aprobar.</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {c.firmado
                          ? <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800">✓ Firmado</span>
                          : <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-800">Se firmará</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {c.listo
                          ? <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800">✓ Listo</span>
                          : <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-800">Se dejará listo</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {new Date(c._createdDate).toLocaleDateString('es-CL')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confirmación → proceso → resumen */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-3xl w-full max-h-[88vh] flex flex-col">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {resultados ? 'Resumen del proceso' : enProceso ? 'Aprobando…' : `Aprobar ${seleccion.length} contrato(s) migrado(s)`}
            </h3>

            {!progreso && (
              <>
                <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 mb-3 space-y-1">
                  <p>Por cada contrato, en este orden:</p>
                  <ol className="list-decimal ml-5">
                    <li>Registra la firma automática, si falta (queda auditada).</li>
                    <li>Lo deja listo y toma el cupo, si falta.</li>
                    <li>Lo aprueba y deja a cada alumno en su curso y salón, en la lección por la que va el grupo. Sólo agenda las clases que vienen.</li>
                    <li>Genera el contrato de nuevo en el Drive (reemplaza el que ya está).</li>
                  </ol>
                  <p>No se puede deshacer desde la pantalla.</p>
                </div>
                <div className="overflow-auto border border-gray-200 rounded-md divide-y divide-gray-100 mb-3 min-h-0">
                  {seleccion.map(c => (
                    <div key={c._id} className="px-3 py-2 text-sm flex flex-wrap justify-between gap-2">
                      <span className="text-gray-800">
                        {c.primerNombre} {c.primerApellido} <span className="text-gray-400">· {c.contrato}</span>
                      </span>
                      <span className="text-xs text-gray-500">
                        {c.beneficiarios.map(b => b.motivoNoAprobable ? `${b.nombre} (sin salón)` : `${b.nombre}: ${cursoSalon(b)}`).join(' · ') || 'Sin alumnos'}
                        {!c.firmado && ' · se firmará'}
                      </span>
                    </div>
                  ))}
                </div>
                <label className="flex items-start gap-2 text-sm text-gray-800 mb-2 cursor-pointer">
                  <input type="checkbox" checked={enviarWhatsApp} onChange={e => setEnviarWhatsApp(e.target.checked)}
                    className="mt-0.5 h-4 w-4 text-primary-600 rounded border-gray-300" />
                  <span>
                    <strong>Enviar el mensaje de bienvenida por WhatsApp</strong> a cada alumno aprobado
                    (en los cursos de menores va al apoderado). Si no se marca, no se envía nada.
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm text-gray-800 mb-4 cursor-pointer">
                  <input type="checkbox" checked={confirmo} onChange={e => setConfirmo(e.target.checked)}
                    className="mt-0.5 h-4 w-4 text-primary-600 rounded border-gray-300" />
                  <span>Confirmo que quiero aprobar estos {seleccion.length} contrato(s).</span>
                </label>
              </>
            )}

            {enProceso && progreso && (
              <div className="py-6">
                <p className="text-sm text-gray-700 mb-2">Contrato {Math.min(progreso.done + 1, progreso.total)} de {progreso.total}: {progreso.actual}</p>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-2 bg-primary-600 transition-all" style={{ width: `${(progreso.done / progreso.total) * 100}%` }} />
                </div>
                <p className="text-xs text-gray-500 mt-2">Cada contrato genera su PDF: tarda unos segundos. No cierres esta ventana.</p>
              </div>
            )}

            {resultados && (
              <>
                <p className="text-sm text-gray-700 mb-2">
                  <strong className="text-emerald-700">{resultados.filter(r => r.ok).length} aprobado(s)</strong>
                  {resultados.some(r => !r.ok) && <> · <strong className="text-red-700">{resultados.filter(r => !r.ok).length} con error</strong></>}
                  {resultados.some(r => r.ok && r.pdf && !r.pdf.ok) && <> · {resultados.filter(r => r.ok && r.pdf && !r.pdf.ok).length} sin PDF en Drive</>}
                </p>
                <div className="overflow-auto border border-gray-200 rounded-md divide-y divide-gray-100 mb-4 min-h-0">
                  {resultados.map(r => (
                    <div key={r.titularId} className="px-3 py-2 text-sm">
                      <div className="flex items-start gap-2">
                        <span className={r.ok ? 'text-emerald-600' : 'text-red-600'}>{r.ok ? '✓' : '✗'}</span>
                        <div className="flex-1">
                          <span className="font-medium text-gray-900">{r.nombre}</span>
                          <span className="text-gray-400"> · {r.contrato}</span>
                          {!r.ok && <p className="text-xs text-red-700">{r.error}</p>}
                          {r.ok && (
                            <div className="text-xs text-gray-600 space-y-0.5 mt-0.5">
                              <p>
                                Firma: {r.firma === 'REGISTRADA' ? 'registrada ahora' : 'ya estaba'} ·
                                Listo: {r.listo === 'MARCADO' ? 'marcado ahora' : 'ya estaba'} ·
                                PDF: {r.pdf?.ok ? <span className="text-emerald-700">en Drive</span> : <span className="text-red-700">no se generó ({r.pdf?.error})</span>}
                              </p>
                              {(r.beneficiarios || []).map((b, i) => (
                                <p key={i}>
                                  {b.aprobado ? '✓' : '✗'} {b.nombre}
                                  {b.salon && <> · {b.salon}</>}
                                  {b.leccion && <> · {b.leccion}</>}
                                  {' '}· {b.agendamientos} clase(s) agendada(s)
                                  {' '}· WhatsApp {b.whatsapp === 'ENVIADO' ? 'enviado' : b.whatsapp === 'ERROR' ? 'con error' : 'no enviado'}
                                  {b.detalle && <span className="text-amber-700"> — {b.detalle}</span>}
                                </p>
                              ))}
                              {(r.omitidos || []).map((o, i) => (
                                <p key={`o${i}`} className="text-amber-700">⚠ {o.nombre}: no se aprobó — {o.motivo}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 mt-auto">
              {resultados ? (
                <>
                  <button type="button" onClick={descargarResumen}
                    className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1.5">
                    <Download className="w-4 h-4" /> Descargar resumen
                  </button>
                  <button type="button" onClick={() => setModal(false)}
                    className="px-4 py-2 text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700">
                    Cerrar
                  </button>
                </>
              ) : !enProceso && (
                <>
                  <button type="button" onClick={() => setModal(false)}
                    className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">
                    Cancelar
                  </button>
                  <button type="button" disabled={!confirmo || seleccion.length === 0} onClick={aprobar}
                    className="px-4 py-2 text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50">
                    Aprobar {seleccion.length}{enviarWhatsApp ? ' y enviar WhatsApp' : ''}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
