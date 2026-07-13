'use client'

import { useState, useEffect, useMemo } from 'react'
import toast from 'react-hot-toast'
import { TIPOS_CURSO } from '@/lib/cursos-campaign'

interface CursoRow {
  campaign: string
  tipoCurso: string
  horarioCurso: string
  salon: string | null
  numeroUsuarios: number
  usuInscritos: number
}

interface Props {
  studentId: string           // ACADEMICA._id
  studentName: string
  currentCampaign?: string | null
  currentCurso?: string | null // tipoCurso real
  currentSalon?: string | null
  onClose: () => void
  onSuccess: () => void
}

const ordenTipo = (t: string) => { const i = (TIPOS_CURSO as readonly string[]).indexOf(t); return i < 0 ? 99 : i }

export default function StudentCambioAcademico({ studentId, studentName, currentCampaign, currentCurso, currentSalon, onClose, onSuccess }: Props) {
  const [rows, setRows] = useState<CursoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [campaign, setCampaign] = useState('')
  const [tipoCurso, setTipoCurso] = useState('')
  const [rowKey, setRowKey] = useState('') // `${horarioCurso}||${salon}`
  const [motivo, setMotivo] = useState('')
  const [step, setStep] = useState<'form' | 'confirm'>('form')
  const [confirmChk, setConfirmChk] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/postgres/cursos-campaign', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setRows((d.rows || []) as CursoRow[]))
      .catch(() => toast.error('No se pudieron cargar los cursos'))
      .finally(() => setLoading(false))
  }, [])

  const campanias = useMemo(() => Array.from(new Set(rows.map(r => r.campaign))).sort().reverse(), [rows])
  const cursos = useMemo(() => {
    const s = new Set(rows.filter(r => r.campaign === campaign).map(r => r.tipoCurso))
    return Array.from(s).sort((a, b) => ordenTipo(a) - ordenTipo(b))
  }, [rows, campaign])
  const salones = useMemo(
    () => rows.filter(r => r.campaign === campaign && r.tipoCurso === tipoCurso)
              .sort((a, b) => String(a.salon).localeCompare(String(b.salon))),
    [rows, campaign, tipoCurso])

  const selectedRow = useMemo(
    () => salones.find(r => `${r.horarioCurso}||${r.salon || ''}` === rowKey) || null,
    [salones, rowKey])

  const canContinue = !!campaign && !!tipoCurso && !!selectedRow && !!motivo.trim()

  const guardar = async () => {
    if (!selectedRow) return
    setSaving(true)
    try {
      const r = await fetch(`/api/postgres/students/${studentId}/cambio-academico`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign: selectedRow.campaign,
          tipoCurso: selectedRow.tipoCurso,
          horarioCurso: selectedRow.horarioCurso,
          salon: selectedRow.salon || '',
          motivo: motivo.trim(),
        }),
      }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      const b = `${r.bookingsBorrados || 0} clase(s) reasignada(s)`
      toast.success(`Cambio académico aplicado (${b})`)
      onSuccess()
    } catch (e: any) {
      toast.error(e?.message || 'Error al aplicar el cambio')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={() => !saving && onClose()} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <span className="text-xl">🔀</span>
          <h3 className="text-lg font-semibold text-gray-900">Cambio Académico</h3>
        </div>

        {step === 'form' ? (
          <div className="px-6 py-5 space-y-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Beneficiario</p>
              <p className="text-base font-semibold text-gray-900">{studentName}</p>
              <p className="text-xs text-gray-500">
                Actual: {currentCampaign || '—'} · {currentCurso || '—'} · Salón {currentSalon || '—'}
              </p>
            </div>

            {loading ? (
              <div className="py-6 text-center text-sm text-gray-500">Cargando cursos…</div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Campaña destino</label>
                  <select value={campaign} onChange={e => { setCampaign(e.target.value); setTipoCurso(''); setRowKey('') }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    <option value="">Seleccione…</option>
                    {campanias.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Curso destino</label>
                  <select value={tipoCurso} onChange={e => { setTipoCurso(e.target.value); setRowKey('') }}
                    disabled={!campaign} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50">
                    <option value="">Seleccione…</option>
                    {cursos.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Salón / horario destino</label>
                  <select value={rowKey} onChange={e => setRowKey(e.target.value)}
                    disabled={!tipoCurso} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50">
                    <option value="">Seleccione…</option>
                    {salones.map(r => {
                      const k = `${r.horarioCurso}||${r.salon || ''}`
                      const lleno = r.usuInscritos >= r.numeroUsuarios && r.numeroUsuarios > 0
                      return <option key={k} value={k}>
                        Salón {r.salon || '—'} · {r.horarioCurso} ({r.usuInscritos}/{r.numeroUsuarios}{lleno ? ' · LLENO' : ''})
                      </option>
                    })}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Motivo <span className="text-red-500">*</span></label>
                  <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3}
                    placeholder="Motivo del cambio (obligatorio)…"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none" />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              Se moverá al estudiante al curso destino. Las clases <strong>futuras</strong> del curso
              actual se reasignan al nuevo curso; las clases pasadas se conservan. Esta acción queda auditada.
            </div>
            <dl className="grid grid-cols-3 gap-y-2 text-sm">
              <dt className="text-gray-500">De</dt>
              <dd className="col-span-2 text-gray-700">{currentCampaign || '—'} · {currentCurso || '—'} · Salón {currentSalon || '—'}</dd>
              <dt className="text-gray-500">A</dt>
              <dd className="col-span-2 font-medium text-gray-900">{selectedRow?.campaign} · {selectedRow?.tipoCurso} · Salón {selectedRow?.salon || '—'} · {selectedRow?.horarioCurso}</dd>
              <dt className="text-gray-500">Motivo</dt>
              <dd className="col-span-2 text-gray-700">{motivo.trim()}</dd>
            </dl>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={confirmChk} onChange={e => setConfirmChk(e.target.checked)} className="mt-0.5" />
              <span>Confirmo el cambio académico de este beneficiario.</span>
            </label>
          </div>
        )}

        <div className="px-6 py-4 border-t border-gray-100 flex justify-between gap-3">
          <button type="button" onClick={() => step === 'confirm' ? setStep('form') : onClose()} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50">
            {step === 'confirm' ? 'Atrás' : 'Cancelar'}
          </button>
          {step === 'form' ? (
            <button type="button" onClick={() => setStep('confirm')} disabled={!canContinue}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50">
              Continuar
            </button>
          ) : (
            <button type="button" onClick={guardar} disabled={!confirmChk || saving}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50">
              {saving ? 'Aplicando…' : 'Confirmar cambio'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
