'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { AcademicoPermission } from '@/types/permissions'

/**
 * Académico › Mantenimiento › Ajuste masivo — el "Ajuste Lecciones" de la ficha
 * del alumno, aplicado a todo un salón.
 *
 * Se elige Campaña → Curso → Salón, se ve la lista de alumnos con su posición,
 * se elige el Módulo y la Lección destino y "Ver impacto" dice qué se le hará a
 * cada uno. Sólo se mueve HACIA ADELANTE: quien ya va más adelante (o en esa
 * lección) queda como está. La regla vive en el servidor, que vuelve a calcular
 * todo al aplicar; esta pantalla sólo la muestra.
 */

interface Curso {
  _id: string; campaign: string; tipoCurso: string; horarioCurso: string
  salon: string | null; guiaNombre: string | null; inscritos: number
}
type Accion = 'APLICA' | 'RETROCEDE' | 'MAS_ADELANTE' | 'IGUAL' | 'WELCOME' | 'NO_ENCONTRADA'
interface Alumno {
  academicaId: string | null; peopleId: string; nombre: string; numeroId: string | null
  modulo: string | null; leccion: string | null
  accion: Accion | null; aprobar: number; aprobarEval: number; perder: number; perderEval: number; error: string | null
}
interface ModuloOpt { code: string; steps: string[] }
interface Resultado { academicaId: string; nombre: string; ok: boolean; detalle: string }

const ACCION_META: Record<Accion, { label: string; cls: string }> = {
  APLICA:        { label: 'Se ajusta',          cls: 'bg-emerald-100 text-emerald-700' },
  RETROCEDE:     { label: 'Retrocede',           cls: 'bg-red-100 text-red-700' },
  MAS_ADELANTE:  { label: 'Va más adelante',     cls: 'bg-gray-100 text-gray-600' },
  IGUAL:         { label: 'Ya está ahí',         cls: 'bg-gray-100 text-gray-600' },
  WELCOME:       { label: 'En WELCOME',          cls: 'bg-amber-100 text-amber-700' },
  NO_ENCONTRADA: { label: 'Lección no está en sus clases', cls: 'bg-red-100 text-red-700' },
}

export default function AjusteMasivoPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.AJUSTE_MASIVO} showDefaultMessage>
        <AjusteMasivoContent />
      </PermissionGuard>
    </DashboardLayout>
  )
}

const API = '/api/postgres/academic/ajuste-masivo'

function AjusteMasivoContent() {
  const [cursos, setCursos] = useState<Curso[]>([])
  const [campaign, setCampaign] = useState('')
  const [tipoCurso, setTipoCurso] = useState('')
  const [cursoId, setCursoId] = useState('')

  const [alumnos, setAlumnos] = useState<Alumno[]>([])
  const [loadingAlumnos, setLoadingAlumnos] = useState(false)
  const [modulos, setModulos] = useState<ModuloOpt[]>([])
  const [modulo, setModulo] = useState('')
  const [leccion, setLeccion] = useState('')

  const [previewHecho, setPreviewHecho] = useState(false)
  const [loadingPrev, setLoadingPrev] = useState(false)
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [motivo, setMotivo] = useState('')
  const [confirmo, setConfirmo] = useState(false)
  const [retroceder, setRetroceder] = useState(false)
  const [textoConfirma, setTextoConfirma] = useState('')
  const [aplicando, setAplicando] = useState(false)
  const [resultados, setResultados] = useState<Resultado[] | null>(null)

  useEffect(() => {
    fetch(API, { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (d?.error) throw new Error(d.error); setCursos(d.cursos || []) })
      .catch(e => toast.error(e?.message || 'No se pudieron cargar los cursos'))
  }, [])

  const campanias = useMemo(() => Array.from(new Set(cursos.map(c => c.campaign))), [cursos])
  const tipos = useMemo(() => Array.from(new Set(cursos.filter(c => c.campaign === campaign).map(c => c.tipoCurso))), [cursos, campaign])
  const salones = useMemo(() => cursos.filter(c => c.campaign === campaign && c.tipoCurso === tipoCurso), [cursos, campaign, tipoCurso])
  const curso = cursos.find(c => c._id === cursoId) || null
  const lecciones = modulos.find(m => m.code === modulo)?.steps || []

  // Cualquier cambio de salón o de destino invalida la vista previa y lo marcado.
  const limpiarPreview = () => { setPreviewHecho(false); setMarcados(new Set()); setConfirmo(false); setTextoConfirma(''); setResultados(null) }

  const cargarAlumnos = async (id: string, mod?: string, lec?: string, retro = false) => {
    const qs = new URLSearchParams({ cursoId: id })
    if (mod && lec) { qs.set('modulo', mod); qs.set('leccion', lec); if (retro) qs.set('retroceder', '1') }
    const r = await fetch(`${API}?${qs}`, { cache: 'no-store' })
    const d = await r.json()
    if (!r.ok || d?.error) throw new Error(d?.error || 'No se pudo cargar el salón')
    return d.alumnos as Alumno[]
  }

  // Al elegir salón: su lista de alumnos y el currículo de su curso.
  useEffect(() => {
    setAlumnos([]); setModulo(''); setLeccion(''); setRetroceder(false); limpiarPreview()
    if (!cursoId || !curso) return
    let alive = true
    setLoadingAlumnos(true)
    cargarAlumnos(cursoId)
      .then(a => { if (alive) setAlumnos(a) })
      .catch(e => toast.error(e.message))
      .finally(() => { if (alive) setLoadingAlumnos(false) })
    fetch(`/api/postgres/niveles?curso=${encodeURIComponent(curso.tipoCurso)}`, { cache: 'no-store' })
      .then(r => r.json()).then(d => { if (alive) setModulos(d?.modulos || []) }).catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursoId])

  useEffect(() => { limpiarPreview() }, [modulo, leccion, retroceder])

  const verImpacto = async () => {
    if (!cursoId || !modulo || !leccion) return
    setLoadingPrev(true)
    try {
      const a = await cargarAlumnos(cursoId, modulo, leccion, retroceder)
      setAlumnos(a)
      setMarcados(new Set(a.filter(x => (x.accion === 'APLICA' || x.accion === 'RETROCEDE') && x.academicaId).map(x => x.academicaId as string)))
      setPreviewHecho(true)
    } catch (e: any) { toast.error(e.message) } finally { setLoadingPrev(false) }
  }

  const aplicables = alumnos.filter(a => (a.accion === 'APLICA' || a.accion === 'RETROCEDE') && a.academicaId)
  const retrocesos = aplicables.filter(a => a.accion === 'RETROCEDE' && marcados.has(a.academicaId as string))
  const totPerder = retrocesos.reduce((n, a) => n + a.perder, 0)
  const totPerderEval = retrocesos.reduce((n, a) => n + a.perderEval, 0)
  const FRASE = 'RETROCEDER'
  const falta = retrocesos.length > 0 && textoConfirma.trim().toUpperCase() !== FRASE
  const toggle = (id: string) => setMarcados(prev => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n
  })

  const aplicar = async () => {
    setAplicando(true)
    try {
      const r = await fetch(API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cursoId, modulo, leccion, motivo, academicaIds: Array.from(marcados), permitirRetroceso: retroceder }),
      })
      const d = await r.json()
      if (!r.ok || d?.error) throw new Error(d?.error || 'No se pudo aplicar el ajuste')
      setResultados(d.resultados || [])
      toast.success(`Ajuste aplicado a ${d.ok} alumno(s)${d.fail ? ` · ${d.fail} con error` : ''}`)
      // La lista vuelve a leerse: así se ve la posición nueva de cada alumno.
      setAlumnos(await cargarAlumnos(cursoId))
      setPreviewHecho(false); setMarcados(new Set()); setConfirmo(false); setTextoConfirma(''); setMotivo('')
    } catch (e: any) { toast.error(e.message) } finally { setAplicando(false) }
  }

  const sel = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white disabled:bg-gray-50'

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Ajuste masivo</h1>
        <p className="text-sm text-gray-500 mt-1">
          Mueve a todos los alumnos de un salón a la misma lección, igual que <em>Ajuste Lecciones</em> en la ficha
          del alumno. Por defecto sólo hacia adelante: quien ya va más adelante no se toca.
          Para retroceder hay que marcar la casilla del paso 2 y confirmar el efecto.
        </p>
      </div>

      {/* 1 · Salón */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-semibold text-gray-900 mb-3">1 · Salón</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Campaña</label>
            <select value={campaign} onChange={e => { setCampaign(e.target.value); setTipoCurso(''); setCursoId('') }} className={sel}>
              <option value="">Seleccionar…</option>
              {campanias.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Curso</label>
            <select value={tipoCurso} onChange={e => { setTipoCurso(e.target.value); setCursoId('') }} className={sel} disabled={!campaign}>
              <option value="">Seleccionar…</option>
              {tipos.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Salón</label>
            <select value={cursoId} onChange={e => setCursoId(e.target.value)} className={sel} disabled={!tipoCurso}>
              <option value="">Seleccionar…</option>
              {salones.map(s => (
                <option key={s._id} value={s._id}>
                  Salón {s.salon || '—'} · {s.horarioCurso} · {s.inscritos} alumno(s)
                </option>
              ))}
            </select>
          </div>
        </div>
        {curso && (
          <p className="text-xs text-gray-500 mt-2">Guía: {curso.guiaNombre || 'Sin guía asignado'}</p>
        )}
      </section>

      {/* 2 · Destino */}
      {curso && (
        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-semibold text-gray-900 mb-3">2 · Lección destino</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Módulo</label>
              <select value={modulo} onChange={e => { setModulo(e.target.value); setLeccion('') }} className={sel}>
                <option value="">Seleccionar…</option>
                {modulos.map(m => <option key={m.code} value={m.code}>{m.code}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Lección</label>
              <select value={leccion} onChange={e => setLeccion(e.target.value)} className={sel} disabled={!modulo}>
                <option value="">Seleccionar…</option>
                {lecciones.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <button type="button" onClick={verImpacto} disabled={!modulo || !leccion || loadingPrev || !alumnos.length}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
              {loadingPrev ? 'Calculando…' : 'Ver impacto'}
            </button>
          </div>
          <label className="mt-3 flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-0.5" checked={retroceder} onChange={e => setRetroceder(e.target.checked)} />
            <span>
              <strong>Permitir retroceder lecciones.</strong> A quien ya va más adelante que el destino se le
              des-aprueban las lecciones posteriores (pierde su asistencia y evaluaciones de esas lecciones).
            </span>
          </label>
        </section>
      )}

      {/* 3 · Alumnos */}
      {curso && (
        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="font-semibold text-gray-900">3 · Alumnos del salón ({alumnos.length})</h2>
            {previewHecho && (
              <span className="text-xs text-gray-500">
                {aplicables.length} se ajustan · {alumnos.length - aplicables.length} quedan como están
              </span>
            )}
          </div>
          {loadingAlumnos ? (
            <p className="text-sm text-gray-500">Cargando alumnos…</p>
          ) : !alumnos.length ? (
            <p className="text-sm text-gray-500">Este salón no tiene alumnos que ocupen cupo.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-gray-500 border-b">
                    {previewHecho && (
                      <th className="py-2 pr-2 w-8">
                        <input type="checkbox" aria-label="Marcar todos"
                          checked={aplicables.length > 0 && aplicables.every(a => marcados.has(a.academicaId as string))}
                          onChange={e => setMarcados(e.target.checked ? new Set(aplicables.map(a => a.academicaId as string)) : new Set())} />
                      </th>
                    )}
                    <th className="py-2 pr-4">Alumno</th>
                    <th className="py-2 pr-4">ID</th>
                    <th className="py-2 pr-4">Módulo · Lección actual</th>
                    {previewHecho && <th className="py-2 pr-4">Qué se hará</th>}
                  </tr>
                </thead>
                <tbody>
                  {alumnos.map(a => {
                    const meta = a.accion ? ACCION_META[a.accion] : null
                    const puede = (a.accion === 'APLICA' || a.accion === 'RETROCEDE') && !!a.academicaId
                    return (
                      <tr key={a.peopleId} className="border-b border-gray-100">
                        {previewHecho && (
                          <td className="py-2 pr-2">
                            {puede && (
                              <input type="checkbox" checked={marcados.has(a.academicaId as string)}
                                onChange={() => toggle(a.academicaId as string)} aria-label={`Ajustar a ${a.nombre}`} />
                            )}
                          </td>
                        )}
                        <td className="py-2 pr-4">
                          {a.academicaId ? (
                            <a href={`/student/${a.academicaId}`} target="_blank" rel="noopener noreferrer"
                              className="text-primary-700 hover:underline">{a.nombre}</a>
                          ) : a.nombre}
                        </td>
                        <td className="py-2 pr-4 text-gray-600">{a.numeroId || '—'}</td>
                        <td className="py-2 pr-4 text-gray-700">{a.modulo || '—'} · {a.leccion || '—'}</td>
                        {previewHecho && (
                          <td className="py-2 pr-4">
                            {meta && <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${meta.cls}`}>{meta.label}</span>}
                            {a.accion === 'RETROCEDE' && (
                              <span className="ml-2 text-xs text-red-600">
                                pierde {a.perder} lección(es){a.perderEval ? ` (incl. ${a.perderEval} evaluación/es)` : ''}
                              </span>
                            )}
                            {a.accion === 'APLICA' && (
                              <span className="ml-2 text-xs text-gray-500">
                                aprueba {a.aprobar} lección(es){a.aprobarEval ? ` (incl. ${a.aprobarEval} evaluación/es)` : ''}
                              </span>
                            )}
                            {a.error && <span className="ml-2 text-xs text-red-600">{a.error}</span>}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Confirmación */}
          {previewHecho && aplicables.length > 0 && (
            <div className="mt-5 border-t pt-4 space-y-3">
              <p className="text-sm text-gray-700">
                Se moverán <strong>{marcados.size}</strong> alumno(s) a <strong>{modulo} · {leccion}</strong>. A quien va
                atrasado se le aprueban las lecciones anteriores que le falten, con la nota <em>"Ajuste masivo"</em>; la
                asistencia ya marcada de verdad no se toca.
              </p>
              {retrocesos.length > 0 && (
                <div className="border-2 border-red-300 bg-red-50 rounded-lg p-4 text-sm text-red-800 space-y-2">
                  <p className="font-semibold">⚠ Efecto del retroceso</p>
                  <p>
                    <strong>{retrocesos.length}</strong> alumno(s) retroceden a {modulo} · {leccion}: en total se
                    des-aprueban <strong>{totPerder}</strong> lección(es){totPerderEval ? <> (incl. <strong>{totPerderEval}</strong> evaluación/es)</> : null}.
                    Esa asistencia y esas notas se pierden de su historial de avance.
                  </p>
                  <ul className="list-disc ml-5 text-xs">
                    {retrocesos.map(a => (
                      <li key={a.academicaId}>{a.nombre}: {a.modulo} · {a.leccion} → {modulo} · {leccion} (−{a.perder}{a.perderEval ? `, ${a.perderEval} eval.` : ''})</li>
                    ))}
                  </ul>
                  <p className="text-xs">El avance por calendario (cada 15 min) puede devolverlos a la lección en que va su salón.</p>
                  <div>
                    <label className="block text-xs font-medium mb-1">Escribe <strong>{FRASE}</strong> para confirmar</label>
                    <input value={textoConfirma} onChange={e => setTextoConfirma(e.target.value)}
                      className="px-3 py-1.5 text-sm border border-red-300 rounded-lg bg-white" placeholder={FRASE} />
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Motivo <span className="text-red-600">*</span></label>
                <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2} maxLength={500}
                  placeholder="Por qué se ajusta el salón (queda en el historial de cada alumno)"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
              </div>
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input type="checkbox" className="mt-0.5" checked={confirmo} onChange={e => setConfirmo(e.target.checked)} />
                Confirmo el ajuste de {marcados.size} alumno(s). Para deshacerlo hay que ajustarlos de nuevo uno por uno.
              </label>
              <button type="button" onClick={aplicar}
                disabled={aplicando || !confirmo || !motivo.trim() || marcados.size === 0 || falta}
                className="px-5 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
                {aplicando ? 'Aplicando…' : `Aplicar a ${marcados.size} alumno(s)`}
              </button>
            </div>
          )}
          {previewHecho && aplicables.length === 0 && (
            <p className="mt-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              Ningún alumno queda por detrás de {modulo} · {leccion}: no hay nada que ajustar.
            </p>
          )}
        </section>
      )}

      {/* Resultado */}
      {resultados && (
        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-semibold text-gray-900 mb-3">Resultado</h2>
          <ul className="space-y-1 text-sm">
            {resultados.map(r => (
              <li key={r.academicaId} className={r.ok ? 'text-gray-700' : 'text-red-700'}>
                {r.ok ? '✓' : '✗'} <strong>{r.nombre}</strong> — {r.detalle}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
