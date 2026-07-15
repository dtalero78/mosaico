'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import toast from 'react-hot-toast'
import { PermissionGuard } from '@/components/permissions'
import { AcademicoPermission } from '@/types/permissions'
import { TIPOS_CURSO } from '@/lib/cursos-campaign'
import MathText from '@/components/ecuaciones/MathText'
import InsertEquationModal from '@/components/ecuaciones/InsertEquationModal'
import ManualQuestionsEditor, { ManualQuestion, validateManualQuestions } from '@/components/ecuaciones/ManualQuestionsEditor'

interface Leccion {
  step: string
  description: string
  contenido: string
  actividadKahoot?: string
  actividadWordwall?: string
  evaluacionModo?: string
  preguntasManual?: ManualQuestion[]
}

function LeccionEditor({
  curso, code, leccion, onSaved,
}: { curso: string; code: string; leccion: Leccion; onSaved: () => void }) {
  const [description, setDescription] = useState(leccion.description)
  const [contenido, setContenido] = useState(leccion.contenido)
  const [kahoot, setKahoot] = useState(leccion.actividadKahoot || '')
  const [wordwall, setWordwall] = useState(leccion.actividadWordwall || '')
  const [busy, setBusy] = useState(false)
  const [eqOpen, setEqOpen] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const [modo, setModo] = useState<'IA' | 'MANUAL'>((leccion.evaluacionModo as any) === 'MANUAL' ? 'MANUAL' : 'IA')
  const [preguntas, setPreguntas] = useState<ManualQuestion[]>(leccion.preguntasManual || [])
  const [savingEval, setSavingEval] = useState(false)

  useEffect(() => {
    setDescription(leccion.description); setContenido(leccion.contenido)
    setKahoot(leccion.actividadKahoot || ''); setWordwall(leccion.actividadWordwall || '')
    setModo((leccion.evaluacionModo as any) === 'MANUAL' ? 'MANUAL' : 'IA')
    setPreguntas(leccion.preguntasManual || [])
  }, [leccion])

  const saveEval = async () => {
    if (modo === 'MANUAL') {
      const err = validateManualQuestions(preguntas)
      if (err) { toast.error(err); return }
    }
    setSavingEval(true)
    try {
      const r = await fetch('/api/postgres/cursos-contenido', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ curso, code, step: leccion.step, evaluacionModo: modo, preguntasManual: modo === 'MANUAL' ? preguntas : [] }),
      }).then((x) => x.json())
      if (r.error) throw new Error(r.error)
      toast.success(`Evaluación de ${leccion.step} guardada (${modo})`)
      onSaved()
    } catch (e: any) {
      toast.error(e?.message || 'Error al guardar evaluación')
    } finally {
      setSavingEval(false)
    }
  }

  // Inserta el snippet ($...$) en la posición del cursor del textarea.
  const insertSnippet = (snippet: string) => {
    const ta = taRef.current
    if (!ta) { setContenido((c) => c + snippet); return }
    const start = ta.selectionStart ?? contenido.length
    const end = ta.selectionEnd ?? contenido.length
    const next = contenido.slice(0, start) + snippet + contenido.slice(end)
    setContenido(next)
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + snippet.length
      ta.setSelectionRange(pos, pos)
    })
  }

  const dirty = description !== leccion.description || contenido !== leccion.contenido
    || kahoot !== (leccion.actividadKahoot || '') || wordwall !== (leccion.actividadWordwall || '')

  const save = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/postgres/cursos-contenido', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          curso, code, step: leccion.step, description, contenido,
          actividadKahoot: kahoot.trim() || null,
          actividadWordwall: wordwall.trim() || null,
        }),
      }).then((x) => x.json())
      if (r.error) throw new Error(r.error)
      toast.success(`${leccion.step} guardada`)
      onSaved()
    } catch (e: any) {
      toast.error(e?.message || 'Error al guardar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-white">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900">{leccion.step}</h3>
        <button type="button" onClick={save} disabled={busy || !dirty}
          className="px-3 py-1.5 bg-primary text-white text-sm rounded-lg disabled:opacity-40 hover:opacity-90 transition-opacity">
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
      <label className="block text-xs font-medium text-gray-500 mb-1">Descripción (título de la lección)</label>
      <input value={description} onChange={(e) => setDescription(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-3" />
      <div className="flex items-center justify-between mb-1">
        <label className="block text-xs font-medium text-gray-500">Contenido / temario (fuente del quiz IA)</label>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setEqOpen(true)}
            className="px-2.5 py-1 text-xs rounded-md border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100">
            ∑ Insertar ecuación
          </button>
          <button type="button" onClick={() => setShowPreview((v) => !v)}
            className={`px-2.5 py-1 text-xs rounded-md border ${showPreview ? 'border-indigo-300 bg-indigo-100 text-indigo-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {showPreview ? 'Ocultar vista previa' : 'Vista previa'}
          </button>
        </div>
      </div>
      <textarea ref={taRef} value={contenido} onChange={(e) => setContenido(e.target.value)} rows={5}
        placeholder="Objetivos, vocabulario, puntos gramaticales, criterios de evaluación… Usa $...$ para ecuaciones."
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono resize-y" />
      {showPreview && (
        <div className="mt-2 p-3 rounded-lg bg-gray-50 border border-gray-200">
          <div className="text-[11px] font-medium text-gray-400 mb-1">Vista previa</div>
          <MathText block className="text-sm text-gray-800">{contenido || '—'}</MathText>
        </div>
      )}
      <InsertEquationModal open={eqOpen} onClose={() => setEqOpen(false)} onInsert={insertSnippet} />

      {/* Actividades externas (Kahoot / WordWall) */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Actividad Kahoot (URL)</label>
          <input value={kahoot} onChange={(e) => setKahoot(e.target.value)} type="url"
            placeholder="https://kahoot.it/…"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Actividad WordWall (URL)</label>
          <input value={wordwall} onChange={(e) => setWordwall(e.target.value)} type="url"
            placeholder="https://wordwall.net/…"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>

      {/* Evaluación: IA vs MANUAL */}
      <div className="mt-4 pt-4 border-t border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-gray-500">Evaluación</span>
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              <button type="button" onClick={() => setModo('IA')}
                className={`px-3 py-1 ${modo === 'IA' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                IA (del contenido)
              </button>
              <button type="button" onClick={() => setModo('MANUAL')}
                className={`px-3 py-1 ${modo === 'MANUAL' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                Manual
              </button>
            </div>
          </div>
          <button type="button" onClick={saveEval} disabled={savingEval}
            className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg disabled:opacity-40 hover:opacity-90 transition-opacity">
            {savingEval ? 'Guardando…' : 'Guardar evaluación'}
          </button>
        </div>

        {modo === 'IA' ? (
          <p className="text-xs text-gray-400">
            Las 10 preguntas se generan automáticamente del contenido/temario con IA (requiere OPENAI_API_KEY).
          </p>
        ) : (
          <>
            <p className="text-xs text-gray-400 mb-3">
              Preguntas escritas a mano; se califican solas (sin IA). Si aún no hay preguntas, agrega al menos una.
            </p>
            <ManualQuestionsEditor value={preguntas} onChange={setPreguntas} />
          </>
        )}
      </div>
    </div>
  )
}

export default function ContenidoCursoPage() {
  const [curso, setCurso] = useState('')
  const [modulos, setModulos] = useState<{ code: string; steps: string[] }[]>([])
  const [code, setCode] = useState('')
  const [descripcionModulo, setDescripcionModulo] = useState('')
  const [descripcionModuloOrig, setDescripcionModuloOrig] = useState('')
  const [lecciones, setLecciones] = useState<Leccion[]>([])
  const [loadingMod, setLoadingMod] = useState(false)
  const [loadingLec, setLoadingLec] = useState(false)
  const [savingMod, setSavingMod] = useState(false)

  // Curso → módulos
  useEffect(() => {
    if (!curso) { setModulos([]); setCode(''); setLecciones([]); return }
    setLoadingMod(true); setCode(''); setLecciones([])
    fetch(`/api/postgres/niveles?curso=${encodeURIComponent(curso)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setModulos(d.modulos || []))
      .catch(() => toast.error('Error al cargar módulos'))
      .finally(() => setLoadingMod(false))
  }, [curso])

  const load = useCallback(() => {
    if (!curso || !code) { setLecciones([]); setDescripcionModulo(''); return }
    setLoadingLec(true)
    fetch(`/api/postgres/cursos-contenido?curso=${encodeURIComponent(curso)}&code=${encodeURIComponent(code)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setLecciones(d.lecciones || [])
        setDescripcionModulo(d.descripcionModulo || '')
        setDescripcionModuloOrig(d.descripcionModulo || '')
      })
      .catch(() => toast.error('Error al cargar contenido'))
      .finally(() => setLoadingLec(false))
  }, [curso, code])

  useEffect(() => { load() }, [load])

  const saveModulo = async () => {
    setSavingMod(true)
    try {
      const r = await fetch('/api/postgres/cursos-contenido', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ curso, code, descripcionModulo }),
      }).then((x) => x.json())
      if (r.error) throw new Error(r.error)
      setDescripcionModuloOrig(descripcionModulo)
      toast.success('Descripción del módulo guardada')
    } catch (e: any) {
      toast.error(e?.message || 'Error al guardar')
    } finally {
      setSavingMod(false)
    }
  }

  return (
    <PermissionGuard permission={AcademicoPermission.ACTUALIZAR_MATERIAL} showDefaultMessage>
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Contenido del curso</h1>
        <p className="text-gray-500 mb-6">
          Edita la descripción del módulo y el contenido/temario de cada lección. El contenido alimenta el quiz de actividades complementarias.
        </p>

        <div className="flex flex-wrap gap-4 mb-6">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Curso</label>
            <select value={curso} onChange={(e) => setCurso(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm min-w-[180px]">
              <option value="">— Selecciona —</option>
              {TIPOS_CURSO.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Módulo</label>
            <select value={code} onChange={(e) => setCode(e.target.value)} disabled={!curso || loadingMod}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm min-w-[220px] disabled:bg-gray-100">
              <option value="">{loadingMod ? 'Cargando…' : '— Selecciona —'}</option>
              {modulos.map((m) => <option key={m.code} value={m.code}>{m.code}</option>)}
            </select>
          </div>
        </div>

        {loadingLec ? (
          <div className="flex justify-center py-16">
            <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : code && lecciones.length > 0 ? (
          <div className="flex flex-col gap-5">
            {/* Descripción del módulo */}
            <div className="border border-gray-200 rounded-xl p-4 bg-fuchsia-50/40">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold text-gray-900">Descripción del módulo — {code}</h2>
                <button type="button" onClick={saveModulo} disabled={savingMod || descripcionModulo === descripcionModuloOrig}
                  className="px-3 py-1.5 bg-accent text-white text-sm rounded-lg disabled:opacity-40 hover:opacity-90 transition-opacity">
                  {savingMod ? 'Guardando…' : 'Guardar módulo'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-2">Se aplica a todas las lecciones del módulo.</p>
              <textarea value={descripcionModulo} onChange={(e) => setDescripcionModulo(e.target.value)} rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-y" />
            </div>

            {/* Lecciones */}
            {lecciones.map((l) => (
              <LeccionEditor key={l.step} curso={curso} code={code} leccion={l} onSaved={load} />
            ))}
          </div>
        ) : code ? (
          <p className="text-sm text-gray-400 py-8 text-center">Este módulo no tiene lecciones.</p>
        ) : (
          <p className="text-sm text-gray-400 py-8 text-center">Selecciona un curso y un módulo para editar su contenido.</p>
        )}
      </div>
    </PermissionGuard>
  )
}
