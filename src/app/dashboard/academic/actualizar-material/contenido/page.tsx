'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import toast from 'react-hot-toast'
import { PermissionGuard } from '@/components/permissions'
import { AcademicoPermission } from '@/types/permissions'
import { TIPOS_CURSO } from '@/lib/cursos-campaign'
import MathText from '@/components/ecuaciones/MathText'
import InsertEquationModal from '@/components/ecuaciones/InsertEquationModal'
import InsertImageModal from '@/components/ecuaciones/InsertImageModal'
import InsertLinkModal from '@/components/ecuaciones/InsertLinkModal'
import ManualQuestionsEditor, { ManualQuestion, validateManualQuestions, emptyManualQuestion } from '@/components/ecuaciones/ManualQuestionsEditor'

interface Leccion {
  step: string
  description: string
  contenido: string
  actividadKahoot?: string
  actividadWordwall?: string
  actividadKahootNombre?: string
  actividadWordwallNombre?: string
  evaluacionModo?: string
  preguntasManual?: ManualQuestion[]
  evaluacionMinutos?: number
  cuestionarios?: CuestEdit[]
}

interface CuestEdit { id: string; titulo: string; minutos: number; preguntas: ManualQuestion[] }

function LeccionEditor({
  curso, code, leccion, onSaved,
}: { curso: string; code: string; leccion: Leccion; onSaved: () => void }) {
  const [description, setDescription] = useState(leccion.description)
  const [contenido, setContenido] = useState(leccion.contenido)
  // Kahoot descontinuado; solo WordWall por lección.
  const [wordwall, setWordwall] = useState(leccion.actividadWordwall || '')
  const [wordwallNombre, setWordwallNombre] = useState(leccion.actividadWordwallNombre || '')
  const [busy, setBusy] = useState(false)
  const [eqOpen, setEqOpen] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const [modo, setModo] = useState<'IA' | 'MANUAL'>((leccion.evaluacionModo as any) === 'MANUAL' ? 'MANUAL' : 'IA')
  const [preguntas, setPreguntas] = useState<ManualQuestion[]>(leccion.preguntasManual || [])
  const [minutos, setMinutos] = useState<number>(Number(leccion.evaluacionMinutos) > 0 ? Number(leccion.evaluacionMinutos) : 30)
  const [savingEval, setSavingEval] = useState(false)
  const [imgOpen, setImgOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)

  // La casilla "Evaluación" se habilita en módulos/lecciones de Evaluación o
  // Entrenamiento. "evaluac" ya matchea "Evaluación" (el acento va después), así
  // que basta con minúsculas. En IMPULSA CUALQUIER lección puede ser Evaluación
  // (aunque su módulo sea "Modulo NN"), a pedido.
  const esImpulsa = String(curso || '').trim().toUpperCase() === 'IMPULSA'
  const esEvaluacion = esImpulsa || /evaluac|entrenamiento/.test(`${code} ${leccion.step}`.toLowerCase())
  // Admiten VARIOS cuestionarios: los módulos EVALUACIÓN y, en IMPULSA, CUALQUIER
  // lección (entrenamientos y evaluaciones por igual — pedido del usuario).
  const esModuloEvaluacion = esImpulsa || /evaluac/.test(code.toLowerCase())

  const buildCuestFromLeccion = (): CuestEdit[] => {
    const cs = Array.isArray(leccion.cuestionarios) ? leccion.cuestionarios : []
    if (cs.length) return cs.map((c: any, i: number) => ({
      id: String(c?.id || `c${i + 1}`), titulo: String(c?.titulo || `Cuestionario ${i + 1}`),
      minutos: Number(c?.minutos) > 0 ? Number(c?.minutos) : 30, preguntas: Array.isArray(c?.preguntas) ? c.preguntas : [],
    }))
    if ((leccion.preguntasManual || []).length) return [{
      id: 'c1', titulo: 'Cuestionario 1',
      minutos: Number(leccion.evaluacionMinutos) > 0 ? Number(leccion.evaluacionMinutos) : 30,
      preguntas: leccion.preguntasManual || [],
    }]
    return []
  }
  const [cuestionarios, setCuestionarios] = useState<CuestEdit[]>(buildCuestFromLeccion())

  useEffect(() => {
    setDescription(leccion.description); setContenido(leccion.contenido)
    setWordwall(leccion.actividadWordwall || '')
    setWordwallNombre(leccion.actividadWordwallNombre || '')
    setModo((leccion.evaluacionModo as any) === 'MANUAL' ? 'MANUAL' : 'IA')
    setPreguntas(leccion.preguntasManual || [])
    setMinutos(Number(leccion.evaluacionMinutos) > 0 ? Number(leccion.evaluacionMinutos) : 30)
    setCuestionarios(buildCuestFromLeccion())
    limpio.current = huella()   // lo recién cargado ES el punto de partida
    setSucio(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leccion])

  // ── Aviso de cambios sin guardar ──
  // Todo lo que se edita (borrar un cuestionario, mover una pregunta, escribir una
  // ecuación) vive sólo en pantalla hasta pulsar Guardar. Salir sin guardar lo
  // perdía en silencio, sin dejar rastro de que hubo un cambio.
  const huella = () => JSON.stringify({ description, contenido, wordwall, wordwallNombre, modo, minutos, preguntas, cuestionarios })
  const limpio = useRef<string>('')
  const [sucio, setSucio] = useState(false)
  useEffect(() => {
    if (!limpio.current) { limpio.current = huella(); return }
    setSucio(huella() !== limpio.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description, contenido, wordwall, wordwallNombre, modo, minutos, preguntas, cuestionarios])
  useEffect(() => {
    if (!sucio) return
    const avisar = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [sucio])
  /** Tras guardar, lo que hay en pantalla pasa a ser el nuevo punto de partida. */
  const marcarGuardado = () => { limpio.current = huella(); setSucio(false) }

  // ── Multi-cuestionario (solo módulos EVALUACIÓN) ──
  const addCuestionario = () => setCuestionarios((cs) => [
    ...cs, { id: `c${cs.length + 1}_${Math.random().toString(36).slice(2, 6)}`, titulo: `Cuestionario ${cs.length + 1}`, minutos: 30, preguntas: [emptyManualQuestion(1)] },
  ])
  const removeCuestionario = (idx: number) => setCuestionarios((cs) => cs.filter((_, i) => i !== idx))
  const patchCuestionario = (idx: number, patch: Partial<CuestEdit>) => setCuestionarios((cs) => cs.map((c, i) => (i === idx ? { ...c, ...patch } : c)))

  const saveCuestionarios = async () => {
    if (!cuestionarios.length) { toast.error('Agrega al menos un cuestionario.'); return }
    for (const c of cuestionarios) {
      if (!c.titulo.trim()) { toast.error('Cada cuestionario necesita un título.'); return }
      const err = validateManualQuestions(c.preguntas)
      if (err) { toast.error(`«${c.titulo}»: ${err}`); return }
    }
    setSavingEval(true)
    try {
      const r = await fetch('/api/postgres/cursos-contenido', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ curso, code, step: leccion.step, evaluacionModo: 'MANUAL', cuestionarios }),
      }).then((x) => x.json())
      if (r.error) throw new Error(r.error)
      toast.success(`Evaluación de ${leccion.step} guardada (${cuestionarios.length} cuestionario(s))`)
      marcarGuardado(); onSaved()
    } catch (e: any) {
      toast.error(e?.message || 'Error al guardar la evaluación')
    } finally {
      setSavingEval(false)
    }
  }

  // Borra por completo la evaluación de la lección: limpia cuestionarios +
  // preguntas manuales y vuelve el modo a IA (sin evaluación manual).
  const deleteEval = async () => {
    if (!window.confirm(`¿Borrar la evaluación de ${leccion.step}? Se eliminarán todos los cuestionarios y preguntas de esta lección. Esta acción no se puede deshacer.`)) return
    setSavingEval(true)
    try {
      const r = await fetch('/api/postgres/cursos-contenido', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ curso, code, step: leccion.step, evaluacionModo: 'IA', preguntasManual: [], cuestionarios: [] }),
      }).then((x) => x.json())
      if (r.error) throw new Error(r.error)
      setModo('IA'); setPreguntas([]); setCuestionarios([])
      toast.success(`Evaluación de ${leccion.step} borrada`)
      marcarGuardado(); onSaved()
    } catch (e: any) {
      toast.error(e?.message || 'Error al borrar la evaluación')
    } finally {
      setSavingEval(false)
    }
  }

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
        body: JSON.stringify({ curso, code, step: leccion.step, evaluacionModo: modo, preguntasManual: modo === 'MANUAL' ? preguntas : [], evaluacionMinutos: minutos }),
      }).then((x) => x.json())
      if (r.error) throw new Error(r.error)
      toast.success(`Evaluación de ${leccion.step} guardada (${modo})`)
      marcarGuardado(); onSaved()
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
    || wordwall !== (leccion.actividadWordwall || '')
    || wordwallNombre !== (leccion.actividadWordwallNombre || '')

  const save = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/postgres/cursos-contenido', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          curso, code, step: leccion.step, description, contenido,
          actividadWordwall: wordwall.trim() || null,
          actividadWordwallNombre: wordwallNombre.trim() || null,
        }),
      }).then((x) => x.json())
      if (r.error) throw new Error(r.error)
      toast.success(`${leccion.step} guardada`)
      marcarGuardado(); onSaved()
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
        {/* Lo editado vive sólo en pantalla hasta pulsar Guardar; el aviso hace
            visible que hay algo pendiente antes de cambiar de lección o cerrar. */}
        {sucio && (
          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 text-[11px] font-semibold">
            ● Cambios sin guardar
          </span>
        )}
      </div>
      <label className="block text-xs font-medium text-gray-500 mb-1">Descripción (título de la lección)</label>
      <input value={description} onChange={(e) => setDescription(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-3" />
      <div className="flex items-center justify-between mb-1">
        <label className="block text-xs font-medium text-gray-500">Contenido / temario / Pregunta</label>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setEqOpen(true)}
            className="px-2.5 py-1 text-xs rounded-md border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100">
            ∑ Ecuación
          </button>
          <button type="button" onClick={() => setImgOpen(true)}
            className="px-2.5 py-1 text-xs rounded-md border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100">
            🖼 Imagen
          </button>
          <button type="button" onClick={() => setLinkOpen(true)}
            className="px-2.5 py-1 text-xs rounded-md border border-sky-200 text-sky-700 bg-sky-50 hover:bg-sky-100">
            🔗 Link
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
      <p className="mt-1 text-[11px] text-gray-500">
        <span className="text-gray-700 font-medium">Precios:</span> el <code className="px-1 bg-gray-100 rounded">$</code> abre
        y cierra una ecuación, así que dos en el mismo renglón se emparejan y lo de en medio sale como fórmula. Un precio por
        renglón funciona tal cual; si van dos juntos, escribe <code className="px-1 bg-gray-100 rounded">\$</code> — ej.{' '}
        <code className="px-1 bg-gray-100 rounded">Cuesta \$10.000 o \$20.000</code>.
      </p>
      {showPreview && (
        <div className="mt-2 p-3 rounded-lg bg-gray-50 border border-gray-200">
          <div className="text-[11px] font-medium text-gray-400 mb-1">Vista previa</div>
          <MathText block className="text-sm text-gray-800">{contenido || '—'}</MathText>
        </div>
      )}
      <InsertEquationModal open={eqOpen} onClose={() => setEqOpen(false)} onInsert={insertSnippet} />
      <InsertImageModal open={imgOpen} onClose={() => setImgOpen(false)} onInsert={insertSnippet} curso={curso} code={code} step={leccion.step} />
      <InsertLinkModal open={linkOpen} onClose={() => setLinkOpen(false)} onInsert={insertSnippet} />

      {/* Actividad externa (WordWall) — nombre visible + URL. Kahoot descontinuado. */}
      <div className="mt-4 grid grid-cols-1 gap-3">
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-gray-500">Actividad WordWall (de la lección)</label>
          <input value={wordwallNombre} onChange={(e) => setWordwallNombre(e.target.value)} type="text"
            placeholder="Nombre visible (ej. WordWall Lección 2)"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <input value={wordwall} onChange={(e) => setWordwall(e.target.value)} type="url"
            placeholder="https://wordwall.net/…"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>

      {/* Botón de actualización de la lección (descripción + temario + actividades) */}
      <div className="mt-3 flex items-center justify-end gap-2">
        {dirty && <span className="text-xs text-amber-600">Cambios sin guardar</span>}
        <button type="button" onClick={save} disabled={busy || !dirty}
          className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg disabled:opacity-40 hover:bg-primary-700 transition-colors">
          {busy ? 'Guardando…' : 'Actualizar lección'}
        </button>
      </div>

      {/* Evaluación — casilla sólo habilitada en módulos/lecciones de Evaluación o Entrenamiento */}
      <div className="mt-4 pt-4 border-t border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <label className={`flex items-center gap-2 text-sm ${esEvaluacion ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
            title={esEvaluacion ? '' : 'Solo disponible en módulos/lecciones de Evaluación o Entrenamiento'}>
            <input type="checkbox" checked={modo === 'MANUAL'} disabled={!esEvaluacion}
              onChange={(e) => setModo(e.target.checked ? 'MANUAL' : 'IA')}
              className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 disabled:cursor-not-allowed" />
            <span className="font-medium text-gray-700">Evaluación</span>
          </label>
          {esEvaluacion && modo === 'MANUAL' && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={esModuloEvaluacion ? saveCuestionarios : saveEval} disabled={savingEval}
                className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg disabled:opacity-40 hover:opacity-90 transition-opacity">
                {savingEval ? 'Guardando…' : 'Guardar evaluación'}
              </button>
              <button type="button" onClick={deleteEval} disabled={savingEval}
                className="px-3 py-1.5 bg-red-600 text-white text-xs rounded-lg disabled:opacity-40 hover:opacity-90 transition-opacity">
                Borrar evaluación
              </button>
            </div>
          )}
        </div>

        {!esEvaluacion ? (
          <p className="text-xs text-gray-400">
            Disponible solo en módulos/lecciones de <strong>Evaluación</strong> o <strong>Entrenamiento</strong>.
          </p>
        ) : modo === 'MANUAL' && esModuloEvaluacion ? (
          /* Módulo EVALUACIÓN → varios cuestionarios (el alumno los presenta en orden) */
          <>
            <p className="text-xs text-gray-400 mb-3">
              Esta evaluación puede tener <strong>varios cuestionarios</strong>. El alumno los presenta <strong>en orden</strong>;
              cada uno tiene su título, su tiempo y sus preguntas (se autocalifican).
            </p>
            <div className="space-y-4">
              {cuestionarios.map((c, ci) => (
                <div key={c.id} className="border border-orange-200 rounded-xl p-4 bg-orange-50/40">
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <span className="text-sm font-bold text-orange-800">Cuestionario {ci + 1}</span>
                    <input value={c.titulo} onChange={(e) => patchCuestionario(ci, { titulo: e.target.value })}
                      placeholder="Título (ej. Parte 1 — Operaciones directas)"
                      className="flex-1 min-w-[180px] px-2 py-1 border border-gray-300 rounded-md text-sm" />
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => patchCuestionario(ci, { minutos: Math.max(1, c.minutos - 5) })}
                        className="w-7 h-7 rounded-md border border-gray-300 text-gray-700 hover:bg-white font-bold leading-none">−</button>
                      <input type="number" min={1} max={180} value={c.minutos}
                        onChange={(e) => patchCuestionario(ci, { minutos: Math.min(180, Math.max(1, Math.round(Number(e.target.value) || 1))) })}
                        className="w-14 text-center border border-gray-300 rounded-md py-1 text-sm" />
                      <button type="button" onClick={() => patchCuestionario(ci, { minutos: Math.min(180, c.minutos + 5) })}
                        className="w-7 h-7 rounded-md border border-gray-300 text-gray-700 hover:bg-white font-bold leading-none">+</button>
                      <span className="text-xs text-gray-500">min</span>
                    </div>
                    <button type="button" onClick={() => removeCuestionario(ci)}
                      className="text-xs text-red-500 hover:text-red-700 ml-auto">Eliminar cuestionario</button>
                  </div>
                  <ManualQuestionsEditor value={c.preguntas} onChange={(qs) => patchCuestionario(ci, { preguntas: qs })}
                    curso={curso} code={code} step={leccion.step} />
                </div>
              ))}
            </div>
            <button type="button" onClick={addCuestionario}
              className="mt-3 w-full py-2 border-2 border-dashed border-orange-300 rounded-xl text-sm text-orange-700 hover:border-orange-500 hover:text-orange-800">
              + Agregar cuestionario
            </button>
          </>
        ) : modo === 'MANUAL' ? (
          <>
            {/* Entrenamiento → un solo cuestionario. Temporizador que verá el alumno. */}
            <div className="flex items-center gap-3 mb-3 p-2.5 bg-orange-50 border border-orange-100 rounded-lg">
              <span className="text-sm font-medium text-gray-700">Tiempo del alumno:</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setMinutos((m) => Math.max(1, m - 5))}
                  className="w-7 h-7 rounded-md border border-gray-300 text-gray-700 hover:bg-white font-bold leading-none">−</button>
                <input type="number" min={1} max={180} value={minutos}
                  onChange={(e) => setMinutos(Math.min(180, Math.max(1, Math.round(Number(e.target.value) || 1))))}
                  className="w-16 text-center border border-gray-300 rounded-md py-1 text-sm" />
                <button type="button" onClick={() => setMinutos((m) => Math.min(180, m + 5))}
                  className="w-7 h-7 rounded-md border border-gray-300 text-gray-700 hover:bg-white font-bold leading-none">+</button>
              </div>
              <span className="text-sm text-gray-600">minutos</span>
              <span className="text-[11px] text-gray-400 ml-auto">Se aplica al guardar la evaluación.</span>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              Preguntas escritas a mano (se autocalifican, sin IA). Cada pregunta tiene su enunciado y 4 respuestas
              (marca la correcta). Puedes insertar <strong>ecuaciones, imágenes y links</strong> tanto en el enunciado
              como en las respuestas.
            </p>
            <ManualQuestionsEditor value={preguntas} onChange={setPreguntas} curso={curso} code={code} step={leccion.step} />
          </>
        ) : (
          <p className="text-xs text-gray-400">
            Marca <strong>Evaluación</strong> para convertir esta lección en pregunta(s) de examen.
          </p>
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
  const [recursos, setRecursos] = useState<{ nombre: string; link: string }[]>([])
  // Actividades WordWall del módulo: lista abierta (Kahoot descontinuado).
  const [actividadesWordwall, setActividadesWordwall] = useState<{ nombre: string; link: string }[]>([])
  const [lecciones, setLecciones] = useState<Leccion[]>([])
  const [loadingMod, setLoadingMod] = useState(false)
  const [loadingLec, setLoadingLec] = useState(false)
  const [savingMod, setSavingMod] = useState(false)

  // Switch global: mostrar/ocultar la caja "Lección ##" en el panel del estudiante (IMPULSA).
  const [leccionCardVisible, setLeccionCardVisible] = useState(true)
  const [savingFlag, setSavingFlag] = useState(false)
  useEffect(() => {
    fetch('/api/postgres/config/panel-leccion', { cache: 'no-store' })
      .then((r) => r.json()).then((d) => setLeccionCardVisible(d?.visible !== false)).catch(() => {})
  }, [])
  const toggleLeccionCard = async () => {
    const nuevo = !leccionCardVisible
    setLeccionCardVisible(nuevo); setSavingFlag(true)
    try {
      const r = await fetch('/api/postgres/config/panel-leccion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visible: nuevo }),
      }).then((x) => x.json())
      if (r?.error) throw new Error(r.error)
      toast.success(`Caja "Lección" ${nuevo ? 'visible' : 'oculta'} en el panel del estudiante`)
    } catch (e: any) {
      setLeccionCardVisible(!nuevo); toast.error(e?.message || 'No se pudo guardar')
    } finally { setSavingFlag(false) }
  }

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
        setRecursos(Array.isArray(d.recursos) ? d.recursos : [])
        setActividadesWordwall(Array.isArray(d.actividadesWordwall) ? d.actividadesWordwall : [])
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
        body: JSON.stringify({
          curso, code, descripcionModulo,
          recursos: recursos.map(x => ({ nombre: (x.nombre || '').trim(), link: (x.link || '').trim() })).filter(x => x.nombre || x.link),
          actividadesWordwall: actividadesWordwall.map(x => ({ nombre: (x.nombre || '').trim(), link: (x.link || '').trim() })).filter(x => x.nombre || x.link),
        }),
      }).then((x) => x.json())
      if (r.error) throw new Error(r.error)
      setDescripcionModuloOrig(descripcionModulo)
      toast.success('Módulo guardado (descripción, recursos y actividades)')
    } catch (e: any) {
      toast.error(e?.message || 'Error al guardar')
    } finally {
      setSavingMod(false)
    }
  }

  return (
    <PermissionGuard permission={AcademicoPermission.ACTUALIZAR_MATERIAL} showDefaultMessage>
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Gestión de Contenido</h1>
        <p className="text-gray-500 mb-4">
          Edita la descripción del módulo y el contenido/temario de cada lección. El contenido alimenta el quiz de actividades complementarias.
        </p>

        {/* Switch global: la caja "Lección ##" (cuestionarios de la lección actual) en el panel del estudiante — solo IMPULSA. */}
        <div className="flex items-center justify-between gap-3 mb-6 rounded-xl border border-violet-100 bg-violet-50 px-4 py-3">
          <div className="text-sm">
            <div className="font-semibold text-violet-800">Caja «Lección» en el panel del estudiante</div>
            <div className="text-xs text-violet-700/80">Muestra u oculta, para los alumnos de IMPULSA, la caja con los cuestionarios de su lección actual.</div>
          </div>
          <button type="button" onClick={toggleLeccionCard} disabled={savingFlag}
            role="switch" aria-checked={leccionCardVisible}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${leccionCardVisible ? 'bg-violet-600' : 'bg-gray-300'}`}
            title={leccionCardVisible ? 'Visible — clic para ocultar' : 'Oculta — clic para mostrar'}>
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${leccionCardVisible ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
        </div>

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
                <button type="button" onClick={saveModulo} disabled={savingMod}
                  className="px-4 py-1.5 bg-accent-600 text-white text-sm font-medium rounded-lg disabled:opacity-40 hover:bg-accent-700 transition-colors">
                  {savingMod ? 'Guardando…' : 'Guardar módulo'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-2">Se aplica a todas las lecciones del módulo.</p>
              <textarea value={descripcionModulo} onChange={(e) => setDescripcionModulo(e.target.value)} rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-y" />

              {/* Recursos del módulo (nombre + link) → pestaña "Recursos" del estudiante */}
              <div className="mt-4 pt-3 border-t border-fuchsia-100">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium text-gray-700">Recursos del módulo</label>
                  <button type="button" onClick={() => setRecursos((r) => [...r, { nombre: '', link: '' }])}
                    className="text-xs px-2 py-1 rounded-md border border-fuchsia-200 text-fuchsia-700 bg-white hover:bg-fuchsia-50">
                    + Agregar recurso
                  </button>
                </div>
                <p className="text-xs text-gray-500 mb-2">Links que el estudiante verá en la pestaña <strong>Recursos</strong> (aplican a todo el módulo).</p>
                {recursos.length === 0 ? (
                  <p className="text-xs text-gray-400">Sin recursos. Agrega uno con nombre y link.</p>
                ) : (
                  <div className="space-y-2">
                    {recursos.map((rec, idx) => (
                      <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_1.6fr_auto] gap-2 items-center">
                        <input value={rec.nombre}
                          onChange={(e) => setRecursos((r) => r.map((x, i) => i === idx ? { ...x, nombre: e.target.value } : x))}
                          placeholder="Nombre (ej. Guía en PDF)"
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                        <input value={rec.link} type="url"
                          onChange={(e) => setRecursos((r) => r.map((x, i) => i === idx ? { ...x, link: e.target.value } : x))}
                          placeholder="https://…"
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                        <button type="button" onClick={() => setRecursos((r) => r.filter((_, i) => i !== idx))}
                          className="text-sm px-2 py-2 rounded-md text-red-600 hover:bg-red-50" title="Quitar recurso">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Actividades WordWall del módulo → lista abierta; las ven TODOS los del módulo, sin importar la lección */}
              <div className="mt-4 pt-3 border-t border-fuchsia-100">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700">Actividades WordWall del módulo</label>
                  <button type="button" onClick={() => setActividadesWordwall((a) => [...a, { nombre: '', link: '' }])}
                    className="text-xs px-2 py-1 rounded-md bg-pink-100 text-pink-700 hover:bg-pink-200">
                    + Agregar actividad
                  </button>
                </div>
                <p className="text-xs text-gray-500 mb-2">Puedes agregar <strong>varias</strong> actividades WordWall para <strong>todo el módulo</strong> (las ve cualquier estudiante del módulo, sin importar su lección).</p>
                {actividadesWordwall.length === 0 ? (
                  <p className="text-xs text-gray-400">Sin actividades. Agrega una con nombre y link de WordWall.</p>
                ) : (
                  <div className="space-y-2">
                    {actividadesWordwall.map((act, idx) => (
                      <div key={idx} className="flex gap-2 items-start">
                        <input value={act.nombre} type="text"
                          onChange={(e) => setActividadesWordwall((a) => a.map((x, i) => i === idx ? { ...x, nombre: e.target.value } : x))}
                          placeholder="Nombre visible (ej. WordWall Módulo 1)"
                          className="w-1/3 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                        <input value={act.link} type="url"
                          onChange={(e) => setActividadesWordwall((a) => a.map((x, i) => i === idx ? { ...x, link: e.target.value } : x))}
                          placeholder="https://wordwall.net/…"
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                        <button type="button" onClick={() => setActividadesWordwall((a) => a.filter((_, i) => i !== idx))}
                          className="text-sm px-2 py-2 rounded-md text-red-600 hover:bg-red-50" title="Quitar actividad">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
