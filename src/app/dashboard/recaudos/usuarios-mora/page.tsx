'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { RecaudosPermission } from '@/types/permissions'
import { exportToExcel } from '@/lib/export-excel'
import { ChevronDown, ChevronRight, ChevronLeft, Download, Filter } from 'lucide-react'

/**
 * Recaudos › Usuarios en mora — titulares aprobados con cuotas vencidas sin
 * registrar (misma regla del indicador "En mora" de la ficha financiera:
 * src/lib/mora.ts). Sólo seguimiento: MOSAICO no bloquea nada por la mora.
 */
interface Mora {
  diaCorte: number
  cuotasVencidas: number
  cuotasRegistradas: number
  cuotasAtrasadas: number
  fechaPrimeraImpaga: string | null
  diasMora: number
}
interface UsuarioMora {
  titularId: string
  titular: string
  numeroId: string
  contrato: string
  plataforma: string | null
  finalContrato: string | null
  estadoContrato: 'VIGENTE' | 'ONHOLD' | 'FINALIZADO' | 'INACTIVO'
  celular: string | null
  email: string | null
  gestorRecaudo: string | null
  gestorNombre: string | null
  cursos: string[]
  mora: Mora
  valorCuota: number | null
  valorAtrasado: number | null
  corteSospechoso: boolean
}
interface Beneficiario {
  _id: string
  nombre: string
  numeroId: string
  tipoCurso: string | null
  campaign: string | null
  salon: string | null
  estadoInactivo: boolean | null
  fechaOnHold: string | null
  academicaId: string | null
  nivel: string | null
  step: string | null
}

const PAGE = 25
const fmtFecha = (v: string | null) => {
  if (!v) return '—'
  const [y, m, d] = v.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
const fmtValor = (n: number | null) => (n == null ? '—' : `$${Math.round(n).toLocaleString('es-CO')}`)
const ESTADO_META: Record<UsuarioMora['estadoContrato'], { label: string; cls: string }> = {
  VIGENTE:    { label: 'Vigente',    cls: 'bg-green-100 text-green-800' },
  ONHOLD:     { label: 'OnHold',     cls: 'bg-amber-100 text-amber-800' },
  FINALIZADO: { label: 'Finalizado', cls: 'bg-gray-200 text-gray-700' },
  INACTIVO:   { label: 'Inactivo',   cls: 'bg-red-100 text-red-800' },
}

function Beneficiarios({ contrato }: { contrato: string }) {
  const [data, setData] = useState<Beneficiario[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    fetch(`/api/postgres/recaudos/usuarios-mora/${encodeURIComponent(contrato)}`)
      .then(r => r.json())
      .then(j => { if (alive) j?.success ? setData(j.beneficiarios || []) : setError(j?.error || 'Error al cargar') })
      .catch(() => alive && setError('Error al cargar beneficiarios'))
    return () => { alive = false }
  }, [contrato])

  if (error) return <p className="text-sm text-red-600 px-4 py-3">{error}</p>
  if (!data) return <p className="text-sm text-gray-400 italic px-4 py-3">Cargando beneficiarios…</p>
  if (data.length === 0) return <p className="text-sm text-gray-400 italic px-4 py-3">El contrato no tiene beneficiarios.</p>
  return (
    <table className="min-w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-500">
          <th className="px-4 py-2 font-medium">Beneficiario</th>
          <th className="px-4 py-2 font-medium">Documento</th>
          <th className="px-4 py-2 font-medium">Curso</th>
          <th className="px-4 py-2 font-medium">Módulo actual</th>
          <th className="px-4 py-2 font-medium">Activo</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {data.map(b => (
          <tr key={b._id}>
            <td className="px-4 py-2">
              <a href={b.academicaId ? `/student/${b.academicaId}` : `/person/${b._id}`} target="_blank" rel="noopener noreferrer"
                className="text-primary-700 hover:underline">{b.nombre}</a>
            </td>
            <td className="px-4 py-2 text-gray-700">{b.numeroId}</td>
            <td className="px-4 py-2 text-gray-700">
              {[b.tipoCurso, b.campaign, b.salon ? `Salón ${b.salon}` : ''].filter(Boolean).join(' · ') || <span className="text-gray-400">—</span>}
            </td>
            <td className="px-4 py-2 text-gray-700">
              {b.nivel ? `${b.nivel}${b.step ? ` · ${b.step}` : ''}` : <span className="text-gray-400">Sin ficha académica</span>}
            </td>
            <td className="px-4 py-2">
              {b.fechaOnHold ? <span className="badge bg-amber-100 text-amber-800">OnHold</span>
                : b.estadoInactivo ? <span className="badge bg-red-100 text-red-800">No</span>
                : <span className="badge bg-green-100 text-green-800">Sí</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function UsuariosMoraPage() {
  const [usuarios, setUsuarios] = useState<UsuarioMora[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [plataforma, setPlataforma] = useState('')
  const [estado, setEstado] = useState('')
  const [gestor, setGestor] = useState('')
  const [curso, setCurso] = useState('')
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/postgres/recaudos/usuarios-mora')
      const j = await res.json()
      if (!j?.success) throw new Error(j?.error || 'Error al cargar')
      setUsuarios(j.usuarios || [])
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo cargar el informe')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const plataformas = useMemo(() => Array.from(new Set(usuarios.map(u => u.plataforma).filter(Boolean))).sort() as string[], [usuarios])
  const cursos = useMemo(() => Array.from(new Set(usuarios.flatMap(u => u.cursos || []))).sort(), [usuarios])
  const gestores = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of usuarios) if (u.gestorRecaudo) m.set(u.gestorRecaudo, u.gestorNombre || 'Gestor sin nombre')
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1], 'es'))
  }, [usuarios])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return usuarios.filter(u =>
      (!q || u.titular.toLowerCase().includes(q) || String(u.numeroId || '').toLowerCase().includes(q) || u.contrato.toLowerCase().includes(q)) &&
      (!plataforma || u.plataforma === plataforma) &&
      (!estado || u.estadoContrato === estado) &&
      (!gestor || (gestor === '__SIN__' ? !u.gestorRecaudo : u.gestorRecaudo === gestor)) &&
      (!curso || (u.cursos || []).includes(curso)))
  }, [usuarios, search, plataforma, estado, gestor, curso])
  useEffect(() => { setPage(1) }, [search, plataforma, estado, gestor, curso])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const pageRows = filtered.slice((page - 1) * PAGE, page * PAGE)
  const totalAtrasado = filtered.reduce((s, u) => s + (u.valorAtrasado || 0), 0)

  const toggle = (contrato: string) => setExpanded(prev => {
    const s = new Set(prev)
    s.has(contrato) ? s.delete(contrato) : s.add(contrato)
    return s
  })

  const input = 'w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500'
  return (
    <DashboardLayout>
      <PermissionGuard permission={RecaudosPermission.USUARIOS_MORA_VER} showDefaultMessage>
        <div className="space-y-6">
          <div className="flex justify-between items-start gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">⚠️ Usuarios en mora</h1>
              <p className="mt-2 text-sm text-gray-700">
                Titulares aprobados con cuotas vencidas sin registrar (misma regla del indicador &quot;En mora&quot; de la ficha financiera).
              </p>
            </div>
            <div className="flex gap-3">
              <button type="button" disabled={filtered.length === 0}
                onClick={() => exportToExcel(filtered, [
                  { header: 'Titular', accessor: (u) => u.titular },
                  { header: 'Documento', accessor: (u) => u.numeroId },
                  { header: 'Contrato', accessor: (u) => u.contrato },
                  { header: 'Plataforma', accessor: (u) => u.plataforma || '' },
                  { header: 'Final Contrato', accessor: (u) => fmtFecha(u.finalContrato) },
                  { header: 'Estado Contrato', accessor: (u) => ESTADO_META[u.estadoContrato].label },
                  { header: 'Gestor de Recaudo', accessor: (u) => u.gestorNombre || 'Sin asignar' },
                  { header: 'Cursos', accessor: (u) => (u.cursos || []).join(', ') },
                  { header: 'Celular', accessor: (u) => u.celular || '' },
                  { header: 'Email', accessor: (u) => u.email || '' },
                  { header: 'Día de corte', accessor: (u) => u.mora.diaCorte },
                  { header: 'Cuotas vencidas', accessor: (u) => u.mora.cuotasVencidas },
                  { header: 'Cuotas registradas', accessor: (u) => u.mora.cuotasRegistradas },
                  { header: 'Cuotas atrasadas', accessor: (u) => u.mora.cuotasAtrasadas },
                  { header: 'En mora desde', accessor: (u) => fmtFecha(u.mora.fechaPrimeraImpaga) },
                  { header: 'Días de mora', accessor: (u) => u.mora.diasMora },
                  { header: 'Corte dudoso', accessor: (u) => u.corteSospechoso ? 'Sí' : '' },
                  { header: 'Valor atrasado aprox.', accessor: (u) => u.valorAtrasado ?? '' },
                ], `usuarios-en-mora-${new Date().toISOString().split('T')[0]}`)}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 disabled:opacity-50">
                <Download className="w-4 h-4" /> Exportar Excel
              </button>
              <button type="button" onClick={() => load()}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors flex items-center gap-2">
                <Filter className="w-4 h-4" /> Actualizar
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Los pagos de cuotas se registran en la plataforma desde mayo de 2026: algunos contratos anteriores pueden aparecer aquí
            sin estar realmente en mora. Es un informe de seguimiento: no bloquea ningún servicio.
          </div>

          <div className="card p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-4">
                <label htmlFor="mora-q" className="block text-sm font-medium text-gray-700 mb-1">Buscar</label>
                <input id="mora-q" type="text" placeholder="Nombre, documento o contrato..." value={search} onChange={(e) => setSearch(e.target.value)} className={input} />
              </div>
              <div className="lg:col-span-3">
                <label htmlFor="mora-gestor" className="block text-sm font-medium text-gray-700 mb-1">Gestor de recaudo</label>
                <select id="mora-gestor" value={gestor} onChange={(e) => setGestor(e.target.value)} className={input}>
                  <option value="">Todos</option>
                  <option value="__SIN__">Sin asignar</option>
                  {gestores.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
                </select>
              </div>
              <div className="lg:col-span-2">
                <label htmlFor="mora-curso" className="block text-sm font-medium text-gray-700 mb-1">Curso</label>
                <select id="mora-curso" value={curso} onChange={(e) => setCurso(e.target.value)} className={input}>
                  <option value="">Todos</option>
                  {cursos.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="lg:col-span-3">
                <label htmlFor="mora-plat" className="block text-sm font-medium text-gray-700 mb-1">Plataforma</label>
                <select id="mora-plat" value={plataforma} onChange={(e) => setPlataforma(e.target.value)} className={input}>
                  <option value="">Todas</option>
                  {plataformas.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="lg:col-span-3">
                <label htmlFor="mora-estado" className="block text-sm font-medium text-gray-700 mb-1">Estado del contrato</label>
                <select id="mora-estado" value={estado} onChange={(e) => setEstado(e.target.value)} className={input}>
                  <option value="">Todos</option>
                  {Object.entries(ESTADO_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center flex-wrap gap-2">
            <h2 className="text-lg font-semibold">
              {filtered.length} contrato{filtered.length === 1 ? '' : 's'} en mora
              <span className="ml-2 text-sm font-normal text-gray-500">· valor atrasado aprox. {fmtValor(totalAtrasado)}</span>
            </h2>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="p-2 border rounded-lg disabled:opacity-50 hover:bg-gray-50" aria-label="Anterior"><ChevronLeft className="w-4 h-4" /></button>
                <span className="px-3 py-1 text-sm">{page} de {totalPages}</span>
                <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="p-2 border rounded-lg disabled:opacity-50 hover:bg-gray-50" aria-label="Siguiente"><ChevronRight className="w-4 h-4" /></button>
              </div>
            )}
          </div>

          <div className="card overflow-x-auto">
            {loading ? (
              <p className="p-6 text-center text-gray-500">Cargando…</p>
            ) : filtered.length === 0 ? (
              <p className="p-6 text-center text-gray-500">No hay contratos en mora con estos filtros.</p>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-xs uppercase text-gray-500">
                    <th className="px-3 py-3 w-8"></th>
                    <th className="px-3 py-3">Titular</th>
                    <th className="px-3 py-3">Documento</th>
                    <th className="px-3 py-3">Contrato</th>
                    <th className="px-3 py-3">Final contrato</th>
                    <th className="px-3 py-3">Estado</th>
                    <th className="px-3 py-3">Gestor</th>
                    <th className="px-3 py-3">Curso</th>
                    <th className="px-3 py-3 text-center">Cuotas atrasadas</th>
                    <th className="px-3 py-3 text-center">Días mora</th>
                    <th className="px-3 py-3 text-right">Valor aprox.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pageRows.map(u => {
                    const open = expanded.has(u.contrato)
                    return (
                      <Fragment key={u.contrato}>
                        <tr className={open ? 'bg-primary-50/60' : 'hover:bg-gray-50'}>
                          <td className="px-3 py-2">
                            <button type="button" onClick={() => toggle(u.contrato)} title={open ? 'Ocultar beneficiarios' : 'Ver beneficiarios'}
                              aria-label="Ver beneficiarios" className="text-gray-500 hover:text-gray-800">
                              {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                          </td>
                          <td className="px-3 py-2">
                            <a href={`/person/${u.titularId}?tab=financiera`} target="_blank" rel="noopener noreferrer" className="text-primary-700 hover:underline font-medium">{u.titular}</a>
                            {u.plataforma && <div className="text-xs text-gray-400">{u.plataforma}</div>}
                          </td>
                          <td className="px-3 py-2 text-gray-700">{u.numeroId}</td>
                          <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{u.contrato}</td>
                          <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{fmtFecha(u.finalContrato)}</td>
                          <td className="px-3 py-2"><span className={`badge ${ESTADO_META[u.estadoContrato].cls}`}>{ESTADO_META[u.estadoContrato].label}</span></td>
                          <td className="px-3 py-2 text-gray-700">{u.gestorNombre || <span className="text-gray-400 italic">Sin asignar</span>}</td>
                          <td className="px-3 py-2">
                            {(u.cursos || []).length === 0 ? <span className="text-gray-400">—</span> : (
                              <div className="flex flex-wrap gap-1">
                                {u.cursos.map(c => <span key={c} className="badge bg-primary-100 text-primary-800">{c}</span>)}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center" title={`Vencidas ${u.mora.cuotasVencidas} · registradas ${u.mora.cuotasRegistradas} · corte día ${u.mora.diaCorte}`}>
                            <span className="font-semibold text-red-700">{u.mora.cuotasAtrasadas}</span>
                            <span className="text-xs text-gray-400"> / {u.mora.cuotasVencidas}</span>
                          </td>
                          <td className="px-3 py-2 text-center text-gray-700" title={`En mora desde ${fmtFecha(u.mora.fechaPrimeraImpaga)}`}>
                            {u.mora.diasMora}
                            {u.corteSospechoso && (
                              <span className="ml-1 badge bg-amber-100 text-amber-800" title="La fecha del primer corte es anterior al contrato: probablemente está mal digitada (corrígela en Info Financiera). Los días de mora no son fiables.">⚠ corte</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700 whitespace-nowrap">{fmtValor(u.valorAtrasado)}</td>
                        </tr>
                        {open && (
                          <tr>
                            <td></td>
                            <td colSpan={10} className="bg-gray-50 border-l-4 border-primary-300">
                              <Beneficiarios contrato={u.contrato} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
