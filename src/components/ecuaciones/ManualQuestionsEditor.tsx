'use client';

import { useRef, useState } from 'react';
import MathText from './MathText';
import InsertEquationModal from './InsertEquationModal';

export interface ManualQuestion {
  id: number;
  type: 'multiple_choice' | 'true_false';
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
}: {
  value: ManualQuestion[];
  onChange: (qs: ManualQuestion[]) => void;
}) {
  const [eqOpen, setEqOpen] = useState(false);
  const activeRef = useRef<ActiveField | null>(null);

  const update = (qs: ManualQuestion[]) => onChange(qs);

  const setQuestion = (qi: number, patch: Partial<ManualQuestion>) => {
    update(value.map((q, i) => (i === qi ? { ...q, ...patch } : q)));
  };

  const setType = (qi: number, type: ManualQuestion['type']) => {
    if (type === 'true_false') {
      setQuestion(qi, { type, options: [...TF_OPTIONS], correctAnswer: '' });
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

  const insertSnippet = (snippet: string) => {
    const af = activeRef.current;
    if (!af) return;
    const el = af.el;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const newVal = el.value.slice(0, start) + snippet + el.value.slice(end);
    if (af.kind === 'question') setQuestion(af.qi, { question: newVal });
    else if (af.kind === 'explanation') setQuestion(af.qi, { explanation: newVal });
    else if (af.kind === 'option' && af.oj != null) setOption(af.qi, af.oj, newVal);
    requestAnimationFrame(() => { try { el.focus(); const p = start + snippet.length; el.setSelectionRange(p, p); } catch {} });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {value.length} pregunta(s). Solo opción múltiple / verdadero-falso (se autocalifican).
        </p>
        <button type="button" onClick={() => setEqOpen(true)}
          className="px-2.5 py-1 text-xs rounded-md border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100">
          ∑ Insertar ecuación
        </button>
      </div>

      {value.map((q, qi) => (
        <div key={qi} className="border border-gray-200 rounded-xl p-4 bg-white">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-700">Pregunta {qi + 1}</span>
              <select value={q.type} onChange={(e) => setType(qi, e.target.value as any)}
                className="text-xs border border-gray-300 rounded-md px-2 py-1">
                <option value="multiple_choice">Opción múltiple</option>
                <option value="true_false">Verdadero / Falso</option>
              </select>
            </div>
            <button type="button" onClick={() => removeQuestion(qi)}
              className="text-xs text-red-500 hover:text-red-700">Eliminar</button>
          </div>

          <label className="block text-xs font-medium text-gray-500 mb-1">Enunciado</label>
          <textarea
            value={q.question}
            onFocus={(e) => trackFocus(e.currentTarget, qi, 'question')}
            onChange={(e) => setQuestion(qi, { question: e.target.value })}
            rows={2}
            placeholder="Escribe la pregunta… (usa ∑ para ecuaciones)"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-y"
          />
          {q.question.includes('$') && (
            <div className="mt-1 text-sm text-gray-700"><MathText>{q.question}</MathText></div>
          )}

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
                {opt.includes('$') && (
                  <span className="text-sm text-gray-600"><MathText>{opt}</MathText></span>
                )}
              </div>
            ))}
          </div>
          {q.type === 'multiple_choice' && q.options.length < 6 && (
            <button type="button" onClick={() => addOption(qi)}
              className="mt-2 text-xs text-indigo-600 hover:text-indigo-800">+ Agregar opción</button>
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

      <InsertEquationModal open={eqOpen} onClose={() => setEqOpen(false)} onInsert={insertSnippet} />
    </div>
  );
}

/** Valida el set manual antes de guardar. Devuelve un mensaje de error o null. */
export function validateManualQuestions(qs: ManualQuestion[]): string | null {
  if (!qs.length) return 'Agrega al menos una pregunta.';
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    if (!q.question.trim()) return `Pregunta ${i + 1}: falta el enunciado.`;
    const opts = q.options.map((o) => o.trim()).filter(Boolean);
    if (opts.length < 2) return `Pregunta ${i + 1}: necesita al menos 2 opciones.`;
    if (!q.correctAnswer.trim() || !opts.includes(q.correctAnswer.trim())) {
      return `Pregunta ${i + 1}: marca cuál opción es la correcta.`;
    }
  }
  return null;
}
