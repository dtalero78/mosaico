'use client';

import { useRef, useState } from 'react';
import MathText from './MathText';
import InsertEquationModal from './InsertEquationModal';
import InsertImageModal from './InsertImageModal';
import InsertLinkModal from './InsertLinkModal';

/** ¿El texto trae ecuación, imagen o link (para mostrar la vista previa)? */
const isRich = (s: string) => /\$|!\[|\]\(/.test(s || '');

export interface ManualQuestion {
  id: number;
  /** short_answer = respuesta escrita: `options` son las respuestas aceptadas. */
  type: 'multiple_choice' | 'true_false' | 'short_answer';
  question: string;
  options: string[];
  correctAnswer: string;
  explanation?: string;
}

type FieldKind = 'question' | 'option' | 'explanation';
interface ActiveField {
  el: HTMLInputElement | HTMLTextAreaElement;
  qi: number;
  kind: FieldKind;
  oj?: number;
}

const TF_OPTIONS = ['Verdadero', 'Falso'];

export function emptyManualQuestion(id: number): ManualQuestion {
  return { id, type: 'multiple_choice', question: '', options: ['', '', '', ''], correctAnswer: '', explanation: '' };
}

/**
 * Editor de preguntas MANUALES (opción múltiple / verdadero-falso) para la
 * evaluación de una lección. Reutiliza el editor de ecuaciones (∑) que inserta
 * LaTeX `$...$` en el último campo enfocado (pregunta / opción / explicación).
 * Las preguntas se autocalifican sin OpenAI (coincidencia con `correctAnswer`).
 */
export default function ManualQuestionsEditor({
  value,
  onChange,
  curso = '',
  code = '',
  step = '',
}: {
  value: ManualQuestion[];
  onChange: (qs: ManualQuestion[]) => void;
  /** Para subir imágenes a Spaces (evaluaciones/{curso}/{code}/{step}/). */
  curso?: string;
  code?: string;
  step?: string;
}) {
  const [eqOpen, setEqOpen] = useState(false);
  const [imgOpen, setImgOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [previewQi, setPreviewQi] = useState<number | null>(null);
  const activeRef = useRef<ActiveField | null>(null);

  const update = (qs: ManualQuestion[]) => onChange(qs);

  const setQuestion = (qi: number, patch: Partial<ManualQuestion>) => {
    update(value.map((q, i) => (i === qi ? { ...q, ...patch } : q)));
  };

  const setType = (qi: number, type: ManualQuestion['type']) => {
    if (type === 'true_false') {
      setQuestion(qi, { type, options: [...TF_OPTIONS], correctAnswer: '' });
    } else if (type === 'short_answer') {
      const q = value[qi];
      const opts = q.options.filter((o) => o.trim()).length ? q.options : [''];
      setQuestion(qi, { type, options: opts, correctAnswer: opts.find((o) => o.trim()) || '' });
    } else {
      const q = value[qi];
      const opts = q.options.length >= 2 ? q.options : ['', '', '', ''];
      setQuestion(qi, { type, options: opts });
    }
  };

  const setOption = (qi: number, oj: number, val: string) => {
    const q = value[qi];
    const options = q.options.map((o, j) => (j === oj ? val : o));
    // Si la opción marcada como correcta cambia de texto, sigue la referencia.
    const correctAnswer = q.correctAnswer === q.options[oj] ? val : q.correctAnswer;
    setQuestion(qi, { options, correctAnswer });
  };

  // ── Respuesta escrita (short_answer): las opciones son respuestas aceptadas;
  //    correctAnswer = la primera no vacía (para el feedback). ──
  const setAccepted = (qi: number, oj: number, val: string) => {
    const q = value[qi];
    const options = q.options.map((o, j) => (j === oj ? val : o));
    setQuestion(qi, { options, correctAnswer: options.find((o) => o.trim()) || '' });
  };
  const addAccepted = (qi: number) => {
    const q = value[qi];
    if (q.options.length >= 6) return;
    setQuestion(qi, { options: [...q.options, ''] });
  };
  const removeAccepted = (qi: number, oj: number) => {
    const q = value[qi];
    if (q.options.length <= 1) return;
    const options = q.options.filter((_, j) => j !== oj);
    setQuestion(qi, { options, correctAnswer: options.find((o) => o.trim()) || '' });
  };

  const addOption = (qi: number) => {
    const q = value[qi];
    if (q.options.length >= 6) return;
    setQuestion(qi, { options: [...q.options, ''] });
  };
  const removeOption = (qi: number, oj: number) => {
    const q = value[qi];
    if (q.options.length <= 2) return;
    const options = q.options.filter((_, j) => j !== oj);
    const correctAnswer = q.correctAnswer === q.options[oj] ? '' : q.correctAnswer;
    setQuestion(qi, { options, correctAnswer });
  };

  const addQuestion = () => {
    const nextId = (value.reduce((m, q) => Math.max(m, q.id), 0) || 0) + 1;
    update([...value, emptyManualQuestion(nextId)]);
  };
  const removeQuestion = (qi: number) => update(value.filter((_, i) => i !== qi));

  const trackFocus = (el: HTMLInputElement | HTMLTextAreaElement, qi: number, kind: FieldKind, oj?: number) => {
    activeRef.current = { el, qi, kind, oj };
  };

  // Pregunta cuyo toolbar (∑/🖼/🔗) se usó — evita que la inserción caiga en el
  // campo enfocado de OTRA pregunta.
  const pendingQiRef = useRef<number | null>(null);
  const openInsert = (qi: number, which: 'eq' | 'img' | 'link') => {
    pendingQiRef.current = qi;
    if (which === 'eq') setEqOpen(true);
    else if (which === 'img') setImgOpen(true);
    else setLinkOpen(true);
  };

  const insertSnippet = (snippet: string) => {
    const qi = pendingQiRef.current;
    if (qi == null) return;
    const af = activeRef.current;
    // Sólo insertar en el campo enfocado si pertenece a ESTA pregunta.
    if (af && af.qi === qi) {
      const el = af.el;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      const newVal = el.value.slice(0, start) + snippet + el.value.slice(end);
      if (af.kind === 'question') setQuestion(af.qi, { question: newVal });
      else if (af.kind === 'explanation') setQuestion(af.qi, { explanation: newVal });
      else if (af.kind === 'option' && af.oj != null) setOption(af.qi, af.oj, newVal);
      requestAnimationFrame(() => { try { el.focus(); const p = start + snippet.length; el.setSelectionRange(p, p); } catch {} });
    } else {
      // Sin campo enfocado en esta pregunta → al final de su enunciado.
      const q = value[qi];
      if (q) setQuestion(qi, { question: `${q.question || ''}${q.question && !q.question.endsWith(' ') ? ' ' : ''}${snippet}` });
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        {value.length} pregunta(s). Opción múltiple / verdadero-falso / respuesta escrita (todas se autocalifican, sin IA).
        Cada pregunta tiene sus propios botones <span className="text-gray-700 font-medium">∑ 🖼 🔗</span>: insertan en la
        opción/campo enfocado de esa pregunta, o al final de su enunciado.
      </p>

      {value.map((q, qi) => (
        <div key={qi} className="border border-gray-200 rounded-xl p-4 bg-white">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-700">Pregunta {qi + 1}</span>
              <select value={q.type} onChange={(e) => setType(qi, e.target.value as any)}
                className="text-xs border border-gray-300 rounded-md px-2 py-1">
                <option value="multiple_choice">Opción múltiple</option>
                <option value="true_false">Verdadero / Falso</option>
                <option value="short_answer">Respuesta escrita</option>
              </select>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setPreviewQi(qi)}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">👁 Vista previa</button>
              <button type="button" onClick={() => removeQuestion(qi)}
                className="text-xs text-red-500 hover:text-red-700">Eliminar</button>
            </div>
          </div>

          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-gray-500">Enunciado</label>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => openInsert(qi, 'eq')}
                className="px-2 py-0.5 text-xs rounded-md border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100">∑ Ecuación</button>
              <button type="button" onClick={() => openInsert(qi, 'img')}
                className="px-2 py-0.5 text-xs rounded-md border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100">🖼 Imagen</button>
              <button type="button" onClick={() => openInsert(qi, 'link')}
                className="px-2 py-0.5 text-xs rounded-md border border-sky-200 text-sky-700 bg-sky-50 hover:bg-sky-100">🔗 Link</button>
            </div>
          </div>
          <textarea
            value={q.question}
            onFocus={(e) => trackFocus(e.currentTarget, qi, 'question')}
            onChange={(e) => setQuestion(qi, { question: e.target.value })}
            rows={2}
            placeholder="Escribe la pregunta… (∑ ecuación · 🖼 imagen · 🔗 link)"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-y"
          />
          {isRich(q.question) && (
            <div className="mt-1 text-sm text-gray-700"><MathText block>{q.question}</MathText></div>
          )}

          {q.type === 'short_answer' ? (
            <>
              <label className="block text-xs font-medium text-gray-500 mt-3 mb-1">
                Respuestas aceptadas <span className="text-gray-400 font-normal">(cualquiera se da por correcta)</span>
              </label>
              <div className="space-y-2">
                {q.options.map((opt, oj) => (
                  <div key={oj} className="flex items-center gap-2">
                    <input
                      value={opt}
                      onFocus={(e) => trackFocus(e.currentTarget, qi, 'option', oj)}
                      onChange={(e) => setAccepted(qi, oj, e.target.value)}
                      placeholder={`Respuesta aceptada ${oj + 1} (ej. a^2+2a+1)`}
                      className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                    />
                    {q.options.length > 1 && (
                      <button type="button" onClick={() => removeAccepted(qi, oj)}
                        className="text-gray-400 hover:text-red-500 text-sm px-1" title="Quitar respuesta">×</button>
                    )}
                    {isRich(opt) && (
                      <span className="text-sm text-gray-600"><MathText>{opt}</MathText></span>
                    )}
                  </div>
                ))}
              </div>
              {q.options.length < 6 && (
                <button type="button" onClick={() => addAccepted(qi)}
                  className="mt-2 text-xs text-indigo-600 hover:text-indigo-800">+ Agregar respuesta aceptada</button>
              )}
              <p className="text-[11px] text-gray-400 mt-1">
                El alumno escribe su respuesta; se compara ignorando mayúsculas, tildes y espacios. Agrega las formas
                equivalentes que quieras aceptar (con ∑ puedes escribir la respuesta en LaTeX).
              </p>
            </>
          ) : (
            <>
              <label className="block text-xs font-medium text-gray-500 mt-3 mb-1">
                Opciones {q.type === 'multiple_choice' && '(marca la correcta)'}
              </label>
              <div className="space-y-2">
                {q.options.map((opt, oj) => (
                  <div key={oj} className="flex items-center gap-2">
                    <input type="radio" name={`correct-${qi}`}
                      checked={!!opt && q.correctAnswer === opt}
                      onChange={() => setQuestion(qi, { correctAnswer: opt })}
                      title="Marcar como correcta" />
                    {q.type === 'true_false' ? (
                      <span className="text-sm text-gray-700 flex-1">{opt}</span>
                    ) : (
                      <input
                        value={opt}
                        onFocus={(e) => trackFocus(e.currentTarget, qi, 'option', oj)}
                        onChange={(e) => setOption(qi, oj, e.target.value)}
                        placeholder={`Opción ${oj + 1}`}
                        className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                      />
                    )}
                    {q.type === 'multiple_choice' && q.options.length > 2 && (
                      <button type="button" onClick={() => removeOption(qi, oj)}
                        className="text-gray-400 hover:text-red-500 text-sm px-1" title="Quitar opción">×</button>
                    )}
                    {isRich(opt) && (
                      <span className="text-sm text-gray-600"><MathText>{opt}</MathText></span>
                    )}
                  </div>
                ))}
              </div>
              {q.type === 'multiple_choice' && q.options.length < 6 && (
                <button type="button" onClick={() => addOption(qi)}
                  className="mt-2 text-xs text-indigo-600 hover:text-indigo-800">+ Agregar opción</button>
              )}
            </>
          )}

          <label className="block text-xs font-medium text-gray-500 mt-3 mb-1">Explicación (opcional)</label>
          <input
            value={q.explanation || ''}
            onFocus={(e) => trackFocus(e.currentTarget, qi, 'explanation')}
            onChange={(e) => setQuestion(qi, { explanation: e.target.value })}
            placeholder="Se muestra al estudiante como feedback"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
      ))}

      <button type="button" onClick={addQuestion}
        className="w-full py-2 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-600 hover:border-indigo-400 hover:text-indigo-600">
        + Agregar pregunta
      </button>

      {/* Vista previa de una pregunta — tal como la ve el alumno (la correcta va marcada en verde) */}
      {previewQi != null && value[previewQi] && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => setPreviewQi(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full my-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Vista previa — Pregunta {previewQi + 1}</h3>
              <button type="button" onClick={() => setPreviewQi(null)} title="Cerrar"
                className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
            </div>
            <div className="p-5">
              <p className="text-xs font-semibold text-gray-500 mb-1">
                Pregunta {previewQi + 1} · {value[previewQi].type === 'true_false' ? 'V/F' : value[previewQi].type === 'short_answer' ? 'respuesta escrita' : 'opción múltiple'}
              </p>
              <div className="text-sm text-gray-800 mb-3">
                <MathText block>{value[previewQi].question || '(sin enunciado)'}</MathText>
              </div>
              {value[previewQi].type === 'short_answer' ? (
                <div className="space-y-2">
                  <textarea disabled rows={2} placeholder="El alumno escribe su respuesta aquí…"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-400 resize-none" />
                  <div className="text-xs text-gray-600 bg-emerald-50 border border-emerald-100 rounded-lg p-2">
                    <span className="font-semibold text-emerald-700">Respuestas aceptadas: </span>
                    {value[previewQi].options.filter((o) => o.trim()).length ? (
                      value[previewQi].options.filter((o) => o.trim()).map((o, k, arr) => (
                        <span key={k} className="text-emerald-800"><MathText>{o}</MathText>{k < arr.length - 1 ? ' · ' : ''}</span>
                      ))
                    ) : <span className="text-gray-400">(ninguna configurada)</span>}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {(value[previewQi].type === 'true_false' ? TF_OPTIONS : value[previewQi].options).map((opt, oj) => {
                    const esCorrecta = !!opt && value[previewQi!].correctAnswer === opt;
                    return (
                      <label key={oj} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 border ${esCorrecta ? 'border-emerald-300 bg-emerald-50' : 'border-gray-100'}`}>
                        <input type="radio" disabled checked={esCorrecta} readOnly className="mt-1" />
                        <span className={`text-sm ${esCorrecta ? 'text-emerald-800 font-medium' : 'text-gray-700'}`}>
                          <MathText>{opt || `Opción ${oj + 1}`}</MathText>
                        </span>
                        {esCorrecta && <span className="ml-auto text-[11px] text-emerald-700 font-semibold">✓ correcta</span>}
                      </label>
                    );
                  })}
                </div>
              )}
              {value[previewQi].explanation?.trim() && (
                <div className="mt-3 text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded-lg p-2">
                  <span className="font-semibold text-gray-500">Feedback: </span>
                  <MathText>{value[previewQi].explanation || ''}</MathText>
                </div>
              )}
              <p className="mt-3 text-[11px] text-gray-400">La marca verde (✓ correcta) solo la ves tú; el alumno ve las opciones sin resaltar.</p>
            </div>
          </div>
        </div>
      )}

      <InsertEquationModal open={eqOpen} onClose={() => setEqOpen(false)} onInsert={insertSnippet} />
      <InsertImageModal open={imgOpen} onClose={() => setImgOpen(false)} onInsert={insertSnippet} curso={curso} code={code} step={step} />
      <InsertLinkModal open={linkOpen} onClose={() => setLinkOpen(false)} onInsert={insertSnippet} />
    </div>
  );
}

/** Valida el set manual antes de guardar. Devuelve un mensaje de error o null. */
export function validateManualQuestions(qs: ManualQuestion[]): string | null {
  if (!qs.length) return 'Agrega al menos una pregunta.';
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    if (!q.question.trim()) return `Pregunta ${i + 1}: falta el enunciado.`;
    if (q.type === 'short_answer') {
      const accepted = q.options.map((o) => o.trim()).filter(Boolean);
      if (!accepted.length) return `Pregunta ${i + 1}: agrega al menos una respuesta aceptada.`;
      continue;
    }
    const opts = q.options.map((o) => o.trim()).filter(Boolean);
    if (opts.length < 2) return `Pregunta ${i + 1}: necesita al menos 2 opciones.`;
    if (!q.correctAnswer.trim() || !opts.includes(q.correctAnswer.trim())) {
      return `Pregunta ${i + 1}: marca cuál opción es la correcta.`;
    }
  }
  return null;
}
