'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { TIPOS_CURSO } from '@/lib/cursos-campaign'
import MathText from '@/components/ecuaciones/MathText'
import { decodeHtmlEntities } from '@/lib/math-render'
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline'

interface Preg {
  id: string
  type: 'multiple_choice' | 'true_false'
  question: string
  options: string[]
  correctAnswer: string
  _issues: string[]
}
interface Meta { title: string; description: string; time: string; attempts: string; passing: string }

/* ── Parseo CSV robusto (Tutor LMS): comillas escapadas con \" y con "", CRLF ── */
function parseCsv(text: string): string[][] {
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const rows: string[][] = []
  let row: string[] = [], field = '', i = 0, inQ = false
  while (i < s.length) {
    const c = s[i]
    if (inQ) {
      if (c === '\\' && (s[i + 1] === '"' || s[i + 1] === '\\')) { field += s[i + 1]; i += 2; continue }
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue } inQ = false; i++; continue }
      field += c; i++; continue
    }
    if (c === '"') { inQ = true; i++; continue }
    if (c === ',') { row.push(field); field = ''; i++; continue }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += c; i++
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.length && !(r.length === 1 && r[0] === ''))
}

/* HTML del enunciado → texto/ecuación. Operaciones verticales (líneas de números con
   signo) se reconstruyen como expresión $a - b + c$ para que KaTeX las renderice. */
function htmlLines(html: string): string[] {
  // 1º quitar etiquetas (los <p>/<br> → salto de línea), 2º decodificar entidades.
  let t = String(html || '').replace(/<\/p>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  t = decodeHtmlEntities(t)
  return t.split('\n').map((x) => x.trim()).filter(Boolean)
}
function buildEnunciado(titulo: string, html: string): string {
  const lines = htmlLines(html)
  const nums = lines.map((l) => l.replace(/\s+/g, ''))
  const soloNumeros = nums.length > 0 && nums.every((n) => /^[+\-]?\d+$/.test(n))
  const t = (titulo || '').trim()
  if (soloNumeros) {
    let expr = ''
    nums.forEach((n, idx) => {
      const neg = n.startsWith('-'); const val = n.replace(/^[+\-]/, '')
      expr += idx === 0 ? (neg ? '-' : '') + val : (neg ? ' - ' : ' + ') + val
    })
    return (t ? t + ': ' : '') + '$' + expr + '$'
  }
  const joined = lines.join(' ')
  return t && joined ? `${t}\n${joined}` : (t || joined)
}

function toPreguntas(rows: string[][]): { meta: Meta | null; preguntas: Preg[] } {
  let meta: Meta | null = null
  const preguntas: Preg[] = []
  let cur: { titulo: string; html: string; tutorType: string; answers: { text: string; correct: boolean }[] } | null = null
  const flush = () => {
    if (!cur) return
    const n = preguntas.length + 1
    const isTF = /true_false|true-false|verdadero/i.test(cur.tutorType)
    let options = cur.answers.map((a) => a.text.trim()).filter(Boolean)
    let correct = (cur.answers.find((a) => a.correct)?.text || '').trim()
    if (isTF) {
      const map = (s: string) => (/^(true|verdadero|v|sí|si)$/i.test(s) ? 'Verdadero' : /^(false|falso|f|no)$/i.test(s) ? 'Falso' : s)
      options = ['Verdadero', 'Falso']; correct = map(correct)
    }
    const question = buildEnunciado(cur.titulo, cur.html)
    const issues: string[] = []
    if (!question.trim()) issues.push('Sin enunciado')
    if (isTF) { if (!['Verdadero', 'Falso'].includes(correct)) issues.push('V/F sin correcta') }
    else {
      if (options.length < 2) issues.push('Menos de 2 opciones')
      if (!correct || !options.includes(correct)) issues.push('Correcta no coincide')
    }
    preguntas.push({ id: `q${n}`, type: isTF ? 'true_false' : 'multiple_choice', question, options, correctAnswer: correct, _issues: issues })
    cur = null
  }
  for (const r of rows) {
    const type = (r[0] || '').trim().toLowerCase()
    if (type === 'settings') meta = { title: r[1] || '', description: r[2] || '', time: r[3] || '', attempts: r[6] || '', passing: r[7] || '' }
    else if (type === 'question') { flush(); cur = { titulo: decodeHtmlEntities(r[1] || ''), html: r[2] || '', tutorType: r[3] || '', answers: [] } }
    else if (type === 'answer' && cur) cur.answers.push({ text: decodeHtmlEntities(r[1] || ''), correct: (r[3] || '').trim() === '1' })
  }
  flush()
  return { meta, preguntas }
}

export default function ImportarEvaluacionesPage() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [preguntas, setPreguntas] = useState<Preg[]>([])
  const [fileName, setFileName] = useState('')
  const [curso, setCurso] = useState('')
  const [modulos, setModulos] = useState<{ code: string; steps: string[] }[]>([])
  const [code, setCode] = useState('')
  const [step, setStep] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [previas, setPrevias] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setModulos([]); setCode(''); setStep('')
    if (!curso) return
    fetch(`/api/postgres/niveles?curso=${encodeURIComponent(curso)}`, { cache: 'no-store' })
      .then((r) => r.json()).then((j) => setModulos(Array.isArray(j?.modulos) ? j.modulos : []))
      .catch(() => setModulos([]))
  }, [curso])

  const steps = useMemo(() => modulos.find((m) => m.code === code)?.steps || [], [modulos, code])
  const conError = preguntas.filter((p) => p._issues.length).length
  const listo = curso && code && step && preguntas.length > 0 && conError === 0

  const onFile = async (f: File) => {
    const text = await f.text()
    const { meta, preguntas } = toPreguntas(parseCsv(text))
    if (!preguntas.length) { toast.error('No se encontraron preguntas en el CSV.'); return }
    setMeta(meta); setPreguntas(preguntas); setFileName(f.name)
  }

  const abrirConfirm = async () => {
    try {
      const res = await fetch('/api/postgres/niveles/importar-evaluacion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ curso, code, step, preguntas, apply: false }),
      }).then((r) => r.json())
      if (res.error) throw new Error(res.error)
      setPrevias(res.previas ?? 0); setConfirmOpen(true)
    } catch (e: any) { toast.error(e?.message || 'No se pudo validar la importación') }
  }

  const importar = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/postgres/niveles/importar-evaluacion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ curso, code, step, preguntas, apply: true, minutos: Number(meta?.time) || undefined }),
      }).then((r) => r.json())
      if (res.error) throw new Error(res.error)
      toast.success(`Evaluación importada: ${res.importadas} pregunta(s) en ${curso} / ${code} / ${step}`)
      setConfirmOpen(false)
    } catch (e: any) { toast.error(e?.message || 'Error al importar') } finally { setSaving(false) }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Importar Evaluaciones desde CSV</h1>
      <p className="text-gray-500 mb-6">Sube un CSV de preguntas (formato Tutor LMS) y cárgalo como evaluación manual de una lección. Reemplaza las preguntas de esa lección.</p>

      {/* Carga de archivo */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]) }}
        className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center bg-white hover:border-orange-400 transition-colors cursor-pointer"
        onClick={() => fileRef.current?.click()}
      >
        <ArrowUpTrayIcon className="h-8 w-8 text-orange-500 mx-auto mb-2" />
        <p className="text-sm text-gray-700 font-medium">{fileName ? `Archivo: ${fileName}` : 'Arrastra el CSV aquí o haz clic para elegirlo'}</p>
        <p className="text-xs text-gray-400 mt-1">CSV Tutor LMS (settings / question / answer)</p>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = '' }} />
      </div>

      {meta && (
        <div className="mt-4 bg-orange-50 border border-orange-100 rounded-xl p-4 text-sm">
          <p className="font-semibold text-orange-800">{meta.title}</p>
          {meta.description && <p className="text-gray-600 mt-0.5">{meta.description}</p>}
          <p className="text-xs text-gray-500 mt-2">
            {preguntas.length} pregunta(s){meta.time && ` · ${meta.time} min`}{meta.attempts && ` · ${meta.attempts} intentos`}{meta.passing && ` · aprobación ${meta.passing}`}
          </p>
          <p className="text-[11px] text-gray-400 mt-1">El tiempo del CSV se usa como temporizador del alumno ({Number(meta.time) > 0 ? `${meta.time} min` : '30 min'}); lo puedes ajustar luego en Gestión de Contenido. Intentos/aprobación son informativos.</p>
        </div>
      )}

      {/* Destino */}
      {preguntas.length > 0 && (
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Curso</label>
            <select value={curso} onChange={(e) => setCurso(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="">— Curso —</option>
              {TIPOS_CURSO.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Módulo</label>
            <select value={code} onChange={(e) => { setCode(e.target.value); setStep('') }} disabled={!curso} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100">
              <option value="">— Módulo —</option>
              {modulos.map((m) => <option key={m.code} value={m.code}>{m.code}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Lección</label>
            <select value={step} onChange={(e) => setStep(e.target.value)} disabled={!code} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100">
              <option value="">— Lección —</option>
              {steps.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Preview */}
      {preguntas.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-800">Vista previa ({preguntas.length})</h2>
            {conError > 0 && <span className="text-xs text-red-600 font-medium">{conError} pregunta(s) con problemas</span>}
          </div>
          <div className="space-y-3">
            {preguntas.map((q, i) => (
              <div key={q.id} className={`border rounded-xl p-4 ${q._issues.length ? 'border-red-300 bg-red-50' : 'border-gray-100 bg-white'}`}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-500">Pregunta {i + 1} · {q.type === 'true_false' ? 'V/F' : 'opción múltiple'}</p>
                  {q._issues.length > 0 && <span className="text-[11px] text-red-600">⚠ {q._issues.join(', ')}</span>}
                </div>
                <div className="text-sm text-gray-800 my-2"><MathText block>{q.question}</MathText></div>
                <ul className="space-y-1">
                  {q.options.map((o, oj) => (
                    <li key={oj} className={`text-sm flex items-start gap-2 ${o === q.correctAnswer ? 'text-emerald-700 font-medium' : 'text-gray-600'}`}>
                      <span>{o === q.correctAnswer ? '★' : '•'}</span><MathText>{o}</MathText>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-5 flex justify-end">
            <button type="button" disabled={!listo} onClick={abrirConfirm}
              className="px-5 py-2 rounded-lg bg-orange-600 text-white font-medium hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed text-sm">
              Importar evaluación
            </button>
          </div>
          {!listo && preguntas.length > 0 && (
            <p className="text-xs text-gray-400 mt-1 text-right">
              {conError > 0 ? 'Corrige las preguntas con problemas.' : 'Elige curso, módulo y lección de destino.'}
            </p>
          )}
        </div>
      )}

      {/* Confirmación */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Confirmar importación</h3>
            <p className="text-sm text-gray-600">
              Se cargarán <strong>{preguntas.length}</strong> pregunta(s) en <strong>{curso} / {code} / {step}</strong> como evaluación manual.
            </p>
            {previas && previas > 0 ? (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2 mt-3">
                ⚠ Esta lección ya tiene <strong>{previas}</strong> pregunta(s). Se <strong>reemplazan</strong> por las nuevas.
              </p>
            ) : null}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmOpen(false)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm">Cancelar</button>
              <button type="button" onClick={importar} disabled={saving} className="px-5 py-2 rounded-lg bg-orange-600 text-white font-medium hover:bg-orange-700 disabled:opacity-50 text-sm">
                {saving ? 'Importando…' : 'Confirmar e importar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
