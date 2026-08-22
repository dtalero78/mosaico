'use client'

import { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { AcademicoPermission } from '@/types/permissions'

/**
 * Académico › Sesiones › Festivos.
 *
 * Días sin clase que declara Académico, ADEMÁS de los del calendario de Chile.
 * Los del calendario ya se aplican solos; aquí se agregan los que decide el
 * colegio (la semana de Fiestas Patrias, un puente, un cierre).
 *
 * Declarar el festivo no mueve las clases ya creadas: el botón "Recolocar clases"
 * regenera los cursos afectados preservando la asistencia ya marcada.
 */

interface Festivo {
  _id: string; fecha: string; motivo: string
  creadoPor: string | null; creadoPorNombre: string | null; _createdDate: string
}
interface CursoImpacto {
  _id: string; campaign: string; tipoCurso: string; salon: string | null
  horarioCurso: string | null; alumnos: number
}
interface Preview {
  fecha: string; yaEsFestivo: boolean; yaDeclarado: string | null
  cursos: CursoImpacto[]; sesiones: number; alumnos: number; yaDictadas: number
}
interface Pendiente { fecha: string; motivo: string; sesiones: number }
interface CursoRegen { _id: string; nombre: string }
interface ResRegen { curso: string; eventos?: number; bookings?: number; error?: string }

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/** "2026-09-14" → "lunes 14 de septiembre de 2026" (sin depender del huso local). */
function fmtLargo(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y) return iso
  const dt = new Date(Date.UTC(y, m - 1, d))
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  return `${DIAS[dt.getUTCDay()]} ${d} de ${meses[m - 1]} de ${y}`
}

export default function FestivosPage() {
  const [festivos, setFestivos] = useState<Festivo[]>([])
  const [pendientes, setPendientes] = useState<Pendiente[]>([])
  const [cargando, setCargando] = useState(true)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error' | 'aviso'; texto: string } | null>(null)

  // Alta
  const [fecha, setFecha] = useState('')
  const [motivo, setMotivo] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [guardando, setGuardando] = useState(false)

  // Recolocación — va curso por curso: regenerar uno solo ya reescribe sus eventos
  // y todos los agendamientos de sus alumnos, y en una sola petición para ochenta
  // cursos el navegador se rinde antes de terminar.
  const [regenerando, setRegenerando] = useState(false)
  const [resultados, setResultados] = useState<ResRegen[] | null>(null)
  const [confirmarRegen, setConfirmarRegen] = useState(false)
  const [avance, setAvance] = useState<{ hechos: number; total: number; actual: string } | null>(null)

  const cargar = async () => {
    setCargando(true)
    try {
      const r = await fetch('/api/postgres/academic/festivos', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'No se pudo cargar')
      setFestivos(j.festivos || [])
      setPendientes(j.pendientes || [])
    } catch (e: any) {
      setMsg({ tipo: 'error', texto: e?.message || 'Error al cargar' })
    } finally { setCargando(false) }
  }
  useEffect(() => { cargar() }, [])

  // Vista previa del impacto al elegir fecha.
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { setPreview(null); return }
    let vivo = true
    ;(async () => {
      try {
        const r = await fetch(`/api/postgres/academic/festivos?fecha=${fecha}`, { cache: 'no-store' })
        const j = await r.json()
        if (vivo && r.ok) setPreview(j.preview)
      } catch { /* la vista previa es informativa */ }
    })()
    return () => { vivo = false }
  }, [fecha])

  const puedeGuardar = !!preview && !preview.yaEsFestivo && !preview.yaDeclarado && motivo.trim().length > 0

  const guardar = async () => {
    if (!puedeGuardar) return
    setGuardando(true); setMsg(null)
    try {
      const r = await fetch('/api/postgres/academic/festivos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha, motivo: motivo.trim() }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'No se pudo declarar')
      setMsg({ tipo: 'ok', texto: `Festivo declarado: ${fmtLargo(fecha)}. ${j.sesiones} clase(s) quedan por recolocar.` })
      setFecha(''); setMotivo(''); setPreview(null)
      await cargar()
    } catch (e: any) {
      setMsg({ tipo: 'error', texto: e?.message || 'Error al declarar' })
    } finally { setGuardando(false) }
  }

  const quitar = async (f: Festivo) => {
    setMsg(null)
    try {
      const r = await fetch(`/api/postgres/academic/festivos/${f._id}`, { method: 'DELETE' })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'No se pudo quitar')
      setMsg({ tipo: 'aviso', texto: `Festivo quitado: ${fmtLargo(f.fecha)}. Las clases NO vuelven solas — hay que regenerar el curso desde Campañas.` })
      await cargar()
    } catch (e: any) {
      setMsg({ tipo: 'error', texto: e?.message || 'Error al quitar' })
    }
  }

  const recolocar = async () => {
    setRegenerando(true); setMsg(null); setResultados(null); setConfirmarRegen(false)
    const acumulado: ResRegen[] = []
    try {
      const fechas = pendientes.map((p) => p.fecha).join(',')
      const rl = await fetch(`/api/postgres/academic/festivos/regenerar?fechas=${fechas}`, { cache: 'no-store' })
      const jl = await rl.json()
      if (!rl.ok) throw new Error(jl?.error || 'No se pudo listar los cursos')
      const cursos: CursoRegen[] = jl.cursos || []
      setAvance({ hechos: 0, total: cursos.length, actual: '' })

      for (let i = 0; i < cursos.length; i++) {
        const c = cursos[i]
        setAvance({ hechos: i, total: cursos.length, actual: c.nombre })
        try {
          const r = await fetch('/api/postgres/academic/festivos/regenerar', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cursoId: c._id }),
          })
          const j = await r.json()
          if (!r.ok) throw new Error(j?.error || 'error')
          acumulado.push({ curso: c.nombre, eventos: j.eventos, bookings: j.bookings })
        } catch (e: any) {
          acumulado.push({ curso: c.nombre, error: e?.message || String(e) })
        }
        setResultados([...acumulado])
      }
      const fallidos = acumulado.filter((r) => r.error).length
      setMsg({
        tipo: fallidos ? 'aviso' : 'ok',
        texto: `${acumulado.length} curso(s) recolocados${fallidos ? ` · ${fallidos} con error` : ''}.`,
      })
      await cargar()
    } catch (e: any) {
      setMsg({ tipo: 'error', texto: e?.message || 'Error al regenerar' })
    } finally { setRegenerando(false); setAvance(null) }
  }

  const totalPendientes = useMemo(
    () => pendientes.reduce((a, p) => a + p.sesiones, 0), [pendientes])

  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.FESTIVOS_GESTION} showDefaultMessage>
        <div className="space-y-6">

          <div>
            <h1 className="text-2xl font-bold text-gray-900">🗓️ Festivos</h1>
            <p className="text-gray-600 mt-1">
              Días sin clase que se <strong>suman</strong> al calendario de Chile. Los feriados
              legales ya se aplican solos; aquí se declaran los que decide el colegio.
            </p>
          </div>

          {msg && (
            <div className={`rounded-lg p-4 border ${
              msg.tipo === 'ok' ? 'bg-green-50 border-green-200 text-green-800'
              : msg.tipo === 'aviso' ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-red-50 border-red-200 text-red-800'}`}>
              {msg.texto}
            </div>
          )}

          {/* ── Declarar ─────────────────────────────────────────────────── */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Declarar un día sin clase</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="fecha" className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
                <input
                  id="fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="motivo" className="block text-sm font-medium text-gray-700 mb-1">Motivo</label>
                <input
                  id="motivo" type="text" value={motivo} maxLength={200}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ej. Semana de Fiestas Patrias"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
            </div>

            {preview && (
              <div className="mt-4 space-y-3">
                {preview.yaEsFestivo ? (
                  <div className="bg-sky-50 border border-sky-200 rounded-lg p-4 text-sky-900">
                    <strong>{fmtLargo(preview.fecha)}</strong> ya es feriado del calendario de Chile —
                    ese día no se dicta clase. No hace falta declararlo, y manda el del calendario.
                  </div>
                ) : preview.yaDeclarado ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-900">
                    <strong>{fmtLargo(preview.fecha)}</strong> ya está declarado: “{preview.yaDeclarado}”.
                  </div>
                ) : (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <p className="text-gray-900">
                      <strong>{fmtLargo(preview.fecha)}</strong> — {preview.sesiones} clase(s) programadas,
                      {' '}{preview.alumnos} alumno(s). Las clases se corren al final del curso.
                    </p>
                    {preview.yaDictadas > 0 && (
                      <p className="text-red-700 mt-2">
                        ⚠ {preview.yaDictadas} agendamiento(s) de ese día ya tienen asistencia u otro
                        registro. Declararlo y recolocar los borraría.
                      </p>
                    )}
                    {preview.cursos.length > 0 && (
                      <ul className="mt-2 text-sm text-gray-700 max-h-40 overflow-y-auto">
                        {preview.cursos.map((c) => (
                          <li key={c._id}>
                            · {c.campaign} {c.tipoCurso}/{c.salon || '—'} — {c.horarioCurso} ({c.alumnos} alumno/s)
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <button
                type="button" onClick={guardar} disabled={!puedeGuardar || guardando}
                className="px-4 py-2 rounded-lg text-white bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {guardando ? 'Guardando…' : 'Declarar festivo'}
              </button>
            </div>
          </div>

          {/* ── Recolocar ────────────────────────────────────────────────── */}
          {pendientes.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-amber-900">Clases por recolocar</h2>
              <p className="text-amber-800 mt-1">
                Hay <strong>{totalPendientes}</strong> clase(s) programadas en días ya declarados
                festivos. Declarar el día no mueve las clases ya creadas: recolocarlas regenera
                esos cursos y corre las sesiones al final, conservando la asistencia ya marcada.
              </p>
              <ul className="mt-3 text-sm text-amber-900">
                {pendientes.map((p) => (
                  <li key={p.fecha}>· {fmtLargo(p.fecha)} — {p.motivo} ({p.sesiones} clase/s)</li>
                ))}
              </ul>
              <div className="mt-4">
                {confirmarRegen ? (
                  <div className="bg-white border border-amber-300 rounded-lg p-4">
                    <p className="text-gray-900">
                      Se regenerarán todos los cursos con clase en esos días, uno por uno.
                      Cada curso tarda unos segundos y mueve las fechas de sus clases futuras;
                      con muchos cursos esto puede tomar varios minutos. No cierres la pestaña.
                      ¿Continuar?
                    </p>
                    <div className="mt-3 flex gap-2 justify-end">
                      <button type="button" onClick={() => setConfirmarRegen(false)}
                        className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
                        Cancelar
                      </button>
                      <button type="button" onClick={recolocar} disabled={regenerando}
                        className="px-4 py-2 rounded-lg text-white bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300">
                        Sí, recolocar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmarRegen(true)} disabled={regenerando}
                    className="px-4 py-2 rounded-lg text-white bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300">
                    {regenerando ? 'Recolocando…' : 'Recolocar clases'}
                  </button>
                )}
              </div>
            </div>
          )}

          {avance && (
            <div className="bg-white rounded-lg shadow-sm p-6">
              <p className="text-gray-900 mb-2">
                Recolocando <strong>{avance.hechos + 1}</strong> de {avance.total} — {avance.actual}
              </p>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div className="bg-amber-500 h-2.5 rounded-full transition-all"
                  style={{ width: `${avance.total ? Math.round((avance.hechos / avance.total) * 100) : 0}%` }} />
              </div>
            </div>
          )}

          {resultados && (
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Resultado de la recolocación</h2>
              <div className="max-h-72 overflow-y-auto text-sm">
                {resultados.map((r, i) => (
                  <div key={i} className={r.error ? 'text-red-700' : 'text-gray-700'}>
                    {r.error ? '✕' : '✓'} {r.curso}
                    {r.error ? ` — ${r.error}` : ` — ${r.eventos} clases · ${r.bookings} agendamientos`}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Listado ──────────────────────────────────────────────────── */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Festivos declarados {festivos.length > 0 && <span className="text-gray-500 font-normal">({festivos.length})</span>}
            </h2>
            {cargando ? (
              <p className="text-gray-500">Cargando…</p>
            ) : festivos.length === 0 ? (
              <p className="text-gray-500">
                Todavía no hay ninguno. El calendario de Chile se sigue aplicando solo.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-4">Fecha</th>
                      <th className="py-2 pr-4">Motivo</th>
                      <th className="py-2 pr-4">Declarado por</th>
                      <th className="py-2 pr-4 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {festivos.map((f) => (
                      <tr key={f._id} className="border-b last:border-0">
                        <td className="py-2 pr-4 whitespace-nowrap">{fmtLargo(f.fecha)}</td>
                        <td className="py-2 pr-4">{f.motivo}</td>
                        <td className="py-2 pr-4 text-gray-500">
                          {f.creadoPorNombre || f.creadoPor || '—'}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          <button type="button" onClick={() => quitar(f)}
                            className="text-red-600 hover:text-red-800">
                            Quitar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
