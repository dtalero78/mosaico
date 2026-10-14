'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { ClipboardDocumentCheckIcon, XMarkIcon, ClockIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { AcademicoPermission } from '@/types/permissions'
import MathText from '@/components/ecuaciones/MathText'
import { esRespuestaCorrecta } from '@/lib/cuestionarios'

/**
 * Académico › Guías › Ver Evaluación / Ver Entrenamiento.
 *
 * Elige un curso → una ficha por cada evaluación (o entrenamiento) del curso →
 * al abrirla, sus cuestionarios en pantalla completa con el MISMO diseño que ve
 * el alumno (enunciado, opciones, fórmulas). El Guía ve todos, sin depender del
 * avance de ningún alumno. Sólo lectura: no se envía ni se registra nada.
 *
 * Dos vistas: todas las preguntas en una pantalla, o pregunta por pregunta como
 * la presenta el alumno. "Mostrar respuestas" resalta la correcta y la explicación.
 */
type Tipo = 'evaluacion' | 'entrenamiento'
interface Pregunta { id?: any; type?: string; question?: string; options?: any[]; correctAnswer?: any; explanation?: string }
interface Cuestionario { id: string; titulo: string; minutos: number; step: string; preguntas: Pregunta[] }
interface Modulo { code: string; numero: string; lecciones: string[]; cuestionarios: Cuestionario[]; totalPreguntas: number }

const META: Record<Tipo, { titulo: string; singular: string; permiso: any; tono: { card: string; icon: string; badge: string } }> = {
  evaluacion: {
    titulo: 'Ver Evaluación', singular: 'evaluación', permiso: AcademicoPermission.VER_EVALUACION,
    tono: { card: 'border-rose-200 bg-rose-50 hover:bg-rose-100', icon: 'text-rose-600', badge: 'bg-rose-600' },
  },
  entrenamiento: {
    titulo: 'Ver Entrenamiento', singular: 'entrenamiento', permiso: AcademicoPermission.VER_ENTRENAMIENTO,
    tono: { card: 'border-sky-200 bg-sky-50 hover:bg-sky-100', icon: 'text-sky-600', badge: 'bg-sky-600' },
  },
}

/** Opciones como las ve el alumno (verdadero/falso fijas). */
const opcionesDe = (q: Pregunta): string[] =>
  q.type === 'true_false' ? ['Verdadero', 'Falso'] : (Array.isArray(q.options) ? q.options.map(String) : [])

function PreguntaVista({ q, n, total, mostrar, elegida, onElegir }: {
  q: Pregunta; n: number; total: number; mostrar: boolean
  elegida?: string; onElegir?: (v: string) => void
}) {
  const esCorta = q.type === 'short_answer'
  const aceptadas = esCorta ? [q.correctAnswer, ...(q.options || [])].map(x => String(x ?? '').trim()).filter((x, i, a) => x && a.indexOf(x) === i) : []
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <p className="text-xs text-gray-500 mb-2">Pregunta {n} de {total}</p>
      <div className="text-[15px] font-medium text-gray-800 mb-4"><MathText block>{q.question || ''}</MathText></div>
      {esCorta ? (
        <>
          <textarea rows={2} disabled placeholder="El alumno escribe su respuesta aquí…"
            className="w-full px-3.5 py-3 border border-gray-200 rounded-xl text-sm bg-gray-50 resize-none" />
          {mostrar && (
            <div className="mt-3 rounded-xl bg-green-50 border border-green-200 px-3.5 py-2.5 text-sm text-green-900">
              <span className="font-semibold">Respuestas aceptadas:</span>{' '}
              {aceptadas.length ? aceptadas.map((a, i) => <span key={i}>{i > 0 && ' · '}<MathText>{a}</MathText></span>) : '—'}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-2.5">
          {opcionesDe(q).map((opt, i) => {
            const correcta = mostrar && esRespuestaCorrecta(q, opt)
            const sel = elegida === opt
            const marcaError = mostrar && sel && !correcta
            return (
              <label key={i}
                className={`flex items-center gap-3 border rounded-xl px-3.5 py-3 text-sm ${onElegir ? 'cursor-pointer' : ''} ${
                  correcta ? 'border-green-400 bg-green-50' : marcaError ? 'border-red-300 bg-red-50' : sel ? 'border-fuchsia-400 bg-fuchsia-50' : 'border-gray-200'
                }`}>
                <input type="radio" className="accent-fuchsia-600" checked={sel} disabled={!onElegir}
                  onChange={() => onElegir?.(opt)} />
                <span className="text-gray-800 flex-1"><MathText>{opt}</MathText></span>
                {correcta && <CheckCircleIcon className="h-5 w-5 text-green-600 shrink-0" />}
              </label>
            )
          })}
        </div>
      )}
      {mostrar && q.explanation && (
        <p className="mt-3 rounded-xl bg-gray-50 border border-gray-200 px-3.5 py-2.5 text-sm text-gray-700">
          <span className="font-semibold">Explicación:</span> <MathText>{q.explanation}</MathText>
        </p>
      )}
    </div>
  )
}

function ModuloViewer({ modulo, tipo, onClose }: { modulo: Modulo; tipo: Tipo; onClose: () => void }) {
  const [cIdx, setCIdx] = useState(0)
  const [vista, setVista] = useState<'todas' | 'una'>('todas')
  const [mostrar, setMostrar] = useState(false)
  const [qIdx, setQIdx] = useState(0)
  const [elegidas, setElegidas] = useState<Record<string, string>>({})
  const c = modulo.cuestionarios[cIdx]
  useEffect(() => { setQIdx(0); setElegidas({}) }, [cIdx, vista])

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-gray-50 rounded-2xl shadow-xl max-w-3xl w-full my-6" onClick={e => e.stopPropagation()}>
        <div className="bg-white border-b border-gray-100 rounded-t-2xl px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-900">{modulo.code}</h3>
            <p className="text-xs text-gray-500">{modulo.lecciones.join(' · ')} · vista del Guía (no registra intentos)</p>
          </div>
          <button type="button" onClick={onClose} title="Cerrar" className="text-gray-400 hover:text-gray-600"><XMarkIcon className="h-6 w-6" /></button>
        </div>

        {modulo.cuestionarios.length === 0 ? (
          <p className="px-5 py-16 text-center text-sm text-gray-500">Este {META[tipo].singular} todavía no tiene cuestionarios cargados.</p>
        ) : (
          <>
            {/* Cuestionarios del módulo + controles */}
            <div className="bg-white px-5 pt-3 pb-3 border-b border-gray-100 space-y-3">
              {modulo.cuestionarios.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {modulo.cuestionarios.map((x, i) => (
                    <button key={`${x.step}-${x.id}`} type="button" onClick={() => setCIdx(i)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border ${i === cIdx ? 'bg-purple-700 text-white border-purple-700' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
                      {x.titulo}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-gray-700">
                  <b>{c.titulo}</b> · {c.preguntas.length} preguntas ·{' '}
                  <span className="inline-flex items-center gap-1"><ClockIcon className="h-4 w-4" />{c.minutos} min</span>
                </p>
                <div className="flex items-center gap-3">
                  <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-xs">
                    <button type="button" onClick={() => setVista('todas')}
                      className={`px-3 py-1.5 ${vista === 'todas' ? 'bg-purple-700 text-white' : 'bg-white text-gray-700'}`}>Todas</button>
                    <button type="button" onClick={() => setVista('una')}
                      className={`px-3 py-1.5 ${vista === 'una' ? 'bg-purple-700 text-white' : 'bg-white text-gray-700'}`}>Como el alumno</button>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={mostrar} onChange={e => setMostrar(e.target.checked)} className="accent-green-600" />
                    Mostrar respuestas
                  </label>
                </div>
              </div>
            </div>

            <div className="p-5">
              {c.preguntas.length === 0 ? (
                <p className="py-10 text-center text-sm text-gray-500">Este cuestionario no tiene preguntas.</p>
              ) : vista === 'todas' ? (
                <div className="space-y-3">
                  {c.preguntas.map((q, i) => (
                    <PreguntaVista key={i} q={q} n={i + 1} total={c.preguntas.length} mostrar={mostrar} />
                  ))}
                </div>
              ) : (
                <>
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-4">
                    <div className="h-full bg-gradient-to-r from-purple-600 to-fuchsia-500" style={{ width: `${((qIdx + 1) / c.preguntas.length) * 100}%` }} />
                  </div>
                  <PreguntaVista q={c.preguntas[qIdx]} n={qIdx + 1} total={c.preguntas.length} mostrar={mostrar}
                    elegida={elegidas[String(qIdx)]} onElegir={v => setElegidas(e => ({ ...e, [String(qIdx)]: v }))} />
                  <div className="mt-4 flex items-center justify-between">
                    <button type="button" onClick={() => setQIdx(i => Math.max(0, i - 1))} disabled={qIdx === 0}
                      className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 bg-white hover:bg-gray-50 text-sm disabled:opacity-40">← Atrás</button>
                    <button type="button" onClick={() => setQIdx(i => Math.min(c.preguntas.length - 1, i + 1))} disabled={qIdx === c.preguntas.length - 1}
                      className="px-5 py-2 rounded-lg bg-purple-700 text-white font-medium hover:bg-purple-800 disabled:opacity-40 text-sm">Siguiente →</button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function VerCuestionariosPage({ tipo }: { tipo: Tipo }) {
  const meta = META[tipo]
  const [curso, setCurso] = useState('')
  const [data, setData] = useState<{ cursos: string[]; cursosGuia: string[]; curso: string; modulos: Modulo[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [abierto, setAbierto] = useState<Modulo | null>(null)
  const reqRef = useRef(0)

  const cargar = useCallback(async (c: string) => {
    const id = ++reqRef.current
    setLoading(true)
    try {
      const qs = new URLSearchParams({ tipo })
      if (c) qs.set('curso', c)
      const res = await fetch(`/api/postgres/academic/cuestionarios?${qs}`, { cache: 'no-store' }).then(r => r.json())
      if (id !== reqRef.current) return
      if (res.error) throw new Error(res.error)
      setData(res)
      setCurso(res.curso || '')
    } catch (e: any) {
      if (id === reqRef.current) toast.error(e?.message || 'No se pudieron cargar los cuestionarios')
    } finally {
      if (id === reqRef.current) setLoading(false)
    }
  }, [tipo])

  useEffect(() => { cargar('') }, [cargar])

  const modulos = data?.modulos || []
  const conContenido = useMemo(() => modulos.filter(m => m.cuestionarios.length > 0).length, [modulos])

  return (
    <DashboardLayout>
      <PermissionGuard permission={meta.permiso} showDefaultMessage>
        <div className="max-w-6xl mx-auto space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{meta.titulo}</h1>
            <p className="text-sm text-gray-500">
              Elige el curso y abre cualquier {meta.singular} para verla como la ve el alumno. Puedes mostrar las
              respuestas correctas. Es sólo de consulta: no se registra ningún intento.
            </p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="vc-curso">Curso</label>
              <select id="vc-curso" value={curso} onChange={e => { setCurso(e.target.value); cargar(e.target.value) }}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm min-w-[180px]">
                {(data?.cursos || []).map(c => (
                  <option key={c} value={c.toUpperCase()}>
                    {c}{data?.cursosGuia?.includes(c.toUpperCase()) ? ' (tu curso)' : ''}
                  </option>
                ))}
              </select>
            </div>
            {data && (
              <p className="text-sm text-gray-500 pb-2">
                {modulos.length} {tipo === 'evaluacion' ? 'evaluaciones' : 'entrenamientos'} · {conContenido} con cuestionarios
              </p>
            )}
          </div>

          {loading && !data ? (
            <p className="py-16 text-center text-sm text-gray-400">Cargando…</p>
          ) : modulos.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-500 bg-white rounded-xl border border-gray-200">
              El curso {curso || '—'} no tiene {tipo === 'evaluacion' ? 'evaluaciones' : 'entrenamientos'} en el currículo.
            </p>
          ) : (
            <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 ${loading ? 'opacity-60' : ''}`}>
              {modulos.map(m => {
                const vacio = m.cuestionarios.length === 0
                return (
                  <button key={m.code} type="button" onClick={() => setAbierto(m)}
                    className={`relative text-left rounded-2xl border p-4 transition-colors ${vacio ? 'border-gray-200 bg-gray-50 hover:bg-gray-100' : meta.tono.card}`}>
                    <ClipboardDocumentCheckIcon className={`h-9 w-9 ${vacio ? 'text-gray-400' : meta.tono.icon}`} />
                    <p className="mt-2 font-semibold text-gray-900">{m.code}</p>
                    <p className="text-xs text-gray-600">{m.lecciones.join(' · ')}</p>
                    <p className="mt-2 text-xs text-gray-500">
                      {vacio ? 'Sin cuestionarios' : `${m.cuestionarios.length} cuestionario(s) · ${m.totalPreguntas} preguntas`}
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {abierto && <ModuloViewer modulo={abierto} tipo={tipo} onClose={() => setAbierto(null)} />}
      </PermissionGuard>
    </DashboardLayout>
  )
}
