'use client'

import { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { AcademicoPermission } from '@/types/permissions'
import { usePermissions } from '@/hooks/usePermissions'

/**
 * Académico › Sesiones › Suspende Sesión.
 *
 * Suspende un día-clase de un curso/salón: ese día no se dicta y la sesión se
 * corre al final del curso, para TODOS los alumnos de ese salón. Filtros por
 * guía(s), curso(s), salón(es) —con su horario— y fecha.
 */

interface CursoOpt {
  _id: string; campaign: string; tipoCurso: string; salon: string | null
  horarioCurso: string; guiaId: string | null; guiaNombre: string | null
  inicioCurso: string | null; finalCurso: string | null
}
interface GuiaOpt { _id: string; nombreCompleto: string }
interface Sesion {
  eventoId: string; cursoCampaignId: string; campaign: string; tipoCurso: string
  salon: string | null; horarioCurso: string; guiaNombre: string | null
  fecha: string; hora: string; nivel: string | null; step: string | null
  inscritos: number; conAsistencia: number
}
interface Suspension {
  _id: string; cursoCampaignId: string; curso: string; fecha: string
  motivo: string; realizadoPorNombre: string | null; realizadoPor: string | null; _createdDate: string
}
interface Cambio {
  cursoCampaignId: string; curso: string; fechasSuspendidas: string[]
  ultimaSesionAntes: string | null; ultimaSesionDespues: string | null
  sesionesAntes: number; sesionesDespues: number; alumnos: number
  estadoReaplicado?: number; estadoSinMatch?: number; error?: string
}

const fmt = (d: string | null) => {
  if (!d) return '—'
  const [y, m, dd] = d.slice(0, 10).split('-')
  return `${dd}-${m}-${y}`
}

export default function SuspenderSesionesPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.SUSPENDER_SESIONES_VER} showDefaultMessage>
        <Content />
      </PermissionGuard>
    </DashboardLayout>
  )
}

function Content() {
  const { hasPermission, isRole } = usePermissions()
  const puedeGestionar = hasPermission(AcademicoPermission.SUSPENDER_SESIONES_GESTION)
    || isRole('SUPER_ADMIN') || isRole('ADMIN')

  const [cursosOpt, setCursosOpt] = useState<CursoOpt[]>([])
  const [guiasOpt, setGuiasOpt] = useState<GuiaOpt[]>([])
  const [campanias, setCampanias] = useState<string[]>([])

  const [campaign, setCampaign] = useState('')
  const [guias, setGuias] = useState<string[]>([])
  const [cursos, setCursos] = useState<string[]>([])
  const [salones, setSalones] = useState<string[]>([])
  const [fecha, setFecha] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')

  const [sesiones, setSesiones] = useState<Sesion[]>([])
  const [suspensiones, setSuspensiones] = useState<Suspension[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const [motivo, setMotivo] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [preview, setPreview] = useState<Cambio[] | null>(null)
  const [aplicando, setAplicando] = useState(false)
  const [resultado, setResultado] = useState<Cambio[] | null>(null)

  useEffect(() => {
    fetch('/api/postgres/academic/suspender-sesiones?opciones=1')
      .then(r => r.json())
      .then(j => {
        setCursosOpt(j.opciones?.cursos || [])
        setGuiasOpt(j.opciones?.guias || [])
        setCampanias(j.opciones?.campanias || [])
        if (j.opciones?.campanias?.[0]) setCampaign(j.opciones.campanias[0])
      })
      .catch(() => setMsg('No se pudieron cargar los filtros'))
  }, [])

  // Salones disponibles = cursos de la campaña que cumplen guía/tipo elegidos.
  const salonesDisponibles = useMemo(() => cursosOpt.filter(c =>
    (!campaign || c.campaign === campaign) &&
    (guias.length === 0 || (c.guiaId && guias.includes(c.guiaId))) &&
    (cursos.length === 0 || cursos.includes(c.tipoCurso))
  ), [cursosOpt, campaign, guias, cursos])

  const tiposDisponibles = useMemo(() => Array.from(new Set(
    cursosOpt.filter(c => !campaign || c.campaign === campaign).map(c => c.tipoCurso)
  )), [cursosOpt, campaign])

  const buscar = async () => {
    if (!fecha) { setMsg('Elige una fecha'); return }
    setLoading(true); setMsg(null); setSel(new Set())
    try {
      const qs = new URLSearchParams()
      if (campaign) qs.set('campaign', campaign)
      qs.set('fecha', fecha)
      if (fechaHasta) qs.set('fechaHasta', fechaHasta)
      if (guias.length) qs.set('guias', guias.join(','))
      if (cursos.length) qs.set('cursos', cursos.join(','))
      if (salones.length) qs.set('salones', salones.join(','))
      const j = await fetch(`/api/postgres/academic/suspender-sesiones?${qs}`).then(r => r.json())
      setSesiones(j.sesiones || [])
      setSuspensiones(j.suspensiones || [])
      if ((j.sesiones || []).length === 0) setMsg('No hay sesiones con esos filtros')
    } catch { setMsg('Error al consultar') } finally { setLoading(false) }
  }

  const limpiar = () => {
    setGuias([]); setCursos([]); setSalones([]); setFecha(''); setFechaHasta('')
    setSesiones([]); setSel(new Set()); setMsg(null)
  }

  const abrirConfirmacion = async () => {
    const items = sesiones.filter(s => sel.has(s.eventoId))
      .map(s => ({ cursoCampaignId: s.cursoCampaignId, fecha: s.fecha }))
    if (!items.length) return
    setConfirmando(true); setPreview(null)
    const j = await fetch('/api/postgres/academic/suspender-sesiones', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    }).then(r => r.json()).catch(() => ({}))
    setPreview(j.cambios || [])
  }

  const aplicar = async () => {
    const items = sesiones.filter(s => sel.has(s.eventoId))
      .map(s => ({ cursoCampaignId: s.cursoCampaignId, fecha: s.fecha }))
    setAplicando(true)
    try {
      const j = await fetch('/api/postgres/academic/suspender-sesiones/aplicar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, motivo }),
      }).then(r => r.json())
      if (j.error) throw new Error(j.error)
      setResultado(j.cambios || [])
      setConfirmando(false); setMotivo(''); setSel(new Set())
      await buscar()
    } catch (e: any) {
      setMsg(e?.message || 'Error al suspender')
      setConfirmando(false)
    } finally { setAplicando(false) }
  }

  const revertir = async (s: Suspension) => {
    if (!confirm(`¿Reactivar la sesión del ${fmt(s.fecha)} en ${s.curso}?\n\nLa clase vuelve a dictarse ese día y el curso se recorta al final.`)) return
    setAplicando(true)
    try {
      const j = await fetch('/api/postgres/academic/suspender-sesiones/aplicar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reactivar: { cursoCampaignId: s.cursoCampaignId, fecha: s.fecha } }),
      }).then(r => r.json())
      if (j.error) throw new Error(j.error)
      setResultado(j.cambios || [])
      await buscar()
    } catch (e: any) { setMsg(e?.message || 'Error al reactivar') } finally { setAplicando(false) }
  }

  const toggle = (id: string) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const multi = (v: string[], set: (x: string[]) => void) => (e: any) =>
    set(Array.from(e.target.selectedOptions as any).map((o: any) => o.value))

  const conAsistenciaSel = sesiones.filter(s => sel.has(s.eventoId) && s.conAsistencia > 0)

  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="text-2xl font-bold text-gray-900">🚫 Suspende Sesión</h1>
        <p className="text-sm text-gray-500 mt-1">
          Suspende un día de clase de un curso/salón. La sesión <strong>se corre al final del curso</strong>,
          extendiéndolo para <strong>todos los alumnos de ese salón</strong>. Se conserva el número total de clases.
        </p>
      </div>

      {/* Filtros */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Campaña</label>
            <select className="input-field" value={campaign}
              onChange={e => { setCampaign(e.target.value); setSalones([]) }}>
              <option value="">Todas</option>
              {campanias.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Guía(s)</label>
            <select multiple className="input-field h-24" value={guias}
              onChange={multi(guias, v => { setGuias(v); setSalones([]) })}>
              {guiasOpt.map(g => <option key={g._id} value={g._id}>{g.nombreCompleto}</option>)}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">Vacío = todos</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Curso(s)</label>
            <select multiple className="input-field h-24" value={cursos}
              onChange={multi(cursos, v => { setCursos(v); setSalones([]) })}>
              {tiposDisponibles.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">Vacío = todos</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Salón(es) — con horario</label>
            <select multiple className="input-field h-24" value={salones} onChange={multi(salones, setSalones)}>
              {salonesDisponibles.map(c => (
                <option key={c._id} value={c._id}>
                  {c.tipoCurso} · Salón {c.salon || '—'} — {c.horarioCurso}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">Vacío = todos</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha *</label>
            <input type="date" className="input-field" value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Hasta (opcional)</label>
            <input type="date" className="input-field" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={buscar} disabled={loading} className="btn-primary disabled:opacity-50">
            {loading ? 'Buscando…' : 'Buscar sesiones'}
          </button>
          <button onClick={limpiar} className="btn-secondary">Limpiar filtros</button>
        </div>
        {msg && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-3">{msg}</p>}
      </div>

      {/* Sesiones encontradas */}
      {sesiones.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Sesiones encontradas ({sesiones.length})</h2>
            <div className="flex gap-2">
              <button className="btn-secondary text-xs" onClick={() => setSel(new Set(sesiones.map(s => s.eventoId)))}>Marcar todas</button>
              <button className="btn-secondary text-xs" onClick={() => setSel(new Set())}>Desmarcar</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2 w-10"></th>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Hora</th>
                  <th className="px-3 py-2">Curso</th>
                  <th className="px-3 py-2">Salón · Horario</th>
                  <th className="px-3 py-2">Guía</th>
                  <th className="px-3 py-2">Módulo · Lección</th>
                  <th className="px-3 py-2 text-right">Inscritos</th>
                  <th className="px-3 py-2 text-right">Con asistencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sesiones.map(s => (
                  <tr key={s.eventoId} className={sel.has(s.eventoId) ? 'bg-red-50' : ''}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={sel.has(s.eventoId)} onChange={() => toggle(s.eventoId)}
                        disabled={!puedeGestionar}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmt(s.fecha)}</td>
                    <td className="px-3 py-2">{s.hora}</td>
                    <td className="px-3 py-2 font-medium">{s.tipoCurso}</td>
                    <td className="px-3 py-2">Salón {s.salon || '—'} · {s.horarioCurso}</td>
                    <td className="px-3 py-2">{s.guiaNombre || <span className="text-gray-400">Sin asignar</span>}</td>
                    <td className="px-3 py-2">{[s.nivel, s.step].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="px-3 py-2 text-right">{s.inscritos}</td>
                    <td className="px-3 py-2 text-right">
                      {s.conAsistencia > 0
                        ? <span className="badge bg-amber-100 text-amber-800">{s.conAsistencia}</span>
                        : <span className="text-gray-400">0</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {puedeGestionar && (
            <div className="flex justify-end mt-4">
              <button onClick={abrirConfirmacion} disabled={sel.size === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">
                Suspender {sel.size > 0 ? `(${sel.size})` : ''}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Suspensiones registradas */}
      {suspensiones.length > 0 && (
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-3">Suspensiones registradas ({suspensiones.length})</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Curso</th>
                  <th className="px-3 py-2">Motivo</th>
                  <th className="px-3 py-2">Registró</th>
                  {puedeGestionar && <th className="px-3 py-2"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {suspensiones.map(s => (
                  <tr key={s._id}>
                    <td className="px-3 py-2 whitespace-nowrap">{fmt(s.fecha)}</td>
                    <td className="px-3 py-2">{s.curso}</td>
                    <td className="px-3 py-2 text-gray-600">{s.motivo}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{s.realizadoPorNombre || s.realizadoPor || '—'}</td>
                    {puedeGestionar && (
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => revertir(s)} disabled={aplicando}
                          className="text-xs px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                          Reactivar
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de confirmación */}
      {confirmando && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => !aplicando && setConfirmando(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[85vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Confirmar suspensión</h3>
            <p className="text-sm text-gray-600 mb-4">
              Estas sesiones dejan de dictarse y <strong>se corren al final del curso</strong>. Afecta a
              todos los alumnos de cada salón.
            </p>

            {!preview ? (
              <p className="text-sm text-gray-500 py-6 text-center">Calculando impacto…</p>
            ) : (
              <div className="space-y-3 mb-4">
                {preview.map(c => (
                  <div key={c.cursoCampaignId} className="border border-gray-200 rounded-lg p-3 text-sm">
                    <p className="font-medium text-gray-900">{c.curso}</p>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-gray-600">
                      <div className="flex gap-2"><dt className="text-gray-500">Fechas:</dt><dd>{c.fechasSuspendidas.map(fmt).join(', ')}</dd></div>
                      <div className="flex gap-2"><dt className="text-gray-500">Alumnos:</dt><dd>{c.alumnos}</dd></div>
                      <div className="flex gap-2"><dt className="text-gray-500">Última sesión hoy:</dt><dd>{fmt(c.ultimaSesionAntes)}</dd></div>
                      <div className="flex gap-2"><dt className="text-gray-500">Total de clases:</dt><dd>{c.sesionesAntes} → {c.sesionesDespues} (se conserva)</dd></div>
                    </dl>
                    <p className="text-xs text-gray-500 mt-2">
                      El curso se extenderá {c.fechasSuspendidas.length} sesión(es) más allá del {fmt(c.ultimaSesionAntes)},
                      saltando festivos.
                    </p>
                  </div>
                ))}
              </div>
            )}

            {conAsistenciaSel.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-900">
                ⚠️ {conAsistenciaSel.length} sesión(es) seleccionada(s) ya tienen asistencia marcada.
                Al suspenderlas ese día deja de existir y <strong>esa asistencia se pierde</strong>.
              </div>
            )}

            <label className="block text-sm font-medium text-gray-700 mb-1">Motivo *</label>
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
              className="input-field mb-4" placeholder="Ej: Guía con licencia médica" />

            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmando(false)} disabled={aplicando}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={aplicar} disabled={aplicando || !motivo.trim() || !preview}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">
                {aplicando ? 'Suspendiendo…' : 'Confirmar suspensión'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resultado */}
      {resultado && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setResultado(null)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[85vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Resultado</h3>
            <div className="space-y-3">
              {resultado.map(c => (
                <div key={c.cursoCampaignId} className={`border rounded-lg p-3 text-sm ${c.error ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
                  <p className="font-medium text-gray-900">{c.curso}</p>
                  {c.error ? (
                    <p className="text-red-700 mt-1">❌ {c.error}</p>
                  ) : (
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-gray-700">
                      <div className="flex gap-2"><dt className="text-gray-500">Fechas:</dt><dd>{c.fechasSuspendidas.map(fmt).join(', ')}</dd></div>
                      <div className="flex gap-2"><dt className="text-gray-500">Alumnos:</dt><dd>{c.alumnos}</dd></div>
                      <div className="flex gap-2 col-span-2">
                        <dt className="text-gray-500">Fin del curso:</dt>
                        <dd className="font-medium">{fmt(c.ultimaSesionAntes)} → {fmt(c.ultimaSesionDespues)}</dd>
                      </div>
                      <div className="flex gap-2"><dt className="text-gray-500">Clases:</dt><dd>{c.sesionesAntes} → {c.sesionesDespues}</dd></div>
                      {!!c.estadoSinMatch && (
                        <div className="flex gap-2 col-span-2 text-amber-700">
                          <dt>⚠️ Asistencia sin ubicar:</dt><dd>{c.estadoSinMatch}</dd>
                        </div>
                      )}
                    </dl>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={() => setResultado(null)} className="btn-primary">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
