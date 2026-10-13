'use client'

import { useEffect, useMemo, useState } from 'react'
import { compararHorarios } from '@/lib/cursos-campaign'

interface CursoRow {
  campaign: string
  tipoCurso: string
  horarioCurso: string
  salon: string | null
  numeroUsuarios: number
  usuInscritos: number
}

export interface SalonDestino {
  campaign: string
  tipoCurso: string
  horarioCurso: string
  salon: string
}

interface Props {
  /** Para prellenar (p. ej. el curso que tenía el alumno). */
  inicial?: Partial<SalonDestino> | null
  /** Recibe el destino elegido, o null mientras falte algo o el salón esté lleno. */
  onChange: (destino: SalonDestino | null) => void
}

/**
 * Cascada Campaña → Curso → Salón/Horario, con el cupo de cada salón y los llenos
 * deshabilitados. Lo comparten la reactivación de OnHold (ficha del alumno) y
 * Servicio › Reactivados sin salón. El cupo definitivo lo valida el servidor.
 */
export default function SalonDestinoSelector({ inicial, onChange }: Props) {
  const [rows, setRows] = useState<CursoRow[]>([])
  const [campaign, setCampaign] = useState(inicial?.campaign || '')
  const [tipoCurso, setTipoCurso] = useState(inicial?.tipoCurso || '')
  const [rowKey, setRowKey] = useState(inicial?.horarioCurso ? `${inicial.horarioCurso}||${inicial.salon || ''}` : '')

  useEffect(() => {
    fetch('/api/postgres/cursos-campaign', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setRows(((d.data || d).rows || []) as CursoRow[]))
      .catch(() => setRows([]))
  }, [])

  const campanias = useMemo(() => Array.from(new Set(rows.map(r => r.campaign))).sort().reverse(), [rows])
  const tipos = useMemo(() => Array.from(new Set(rows.filter(r => r.campaign === campaign).map(r => r.tipoCurso))), [rows, campaign])
  // Por día de la semana y hora del horario (lunes primero); el salón desempata.
  const salones = useMemo(
    () => rows.filter(r => r.campaign === campaign && r.tipoCurso === tipoCurso)
              .sort((a, b) => compararHorarios(a.horarioCurso, b.horarioCurso) || String(a.salon).localeCompare(String(b.salon))),
    [rows, campaign, tipoCurso])
  const elegido = useMemo(() => salones.find(r => `${r.horarioCurso}||${r.salon || ''}` === rowKey) || null, [salones, rowKey])
  const lleno = elegido ? (elegido.numeroUsuarios > 0 && (elegido.usuInscritos ?? 0) >= elegido.numeroUsuarios) : false

  useEffect(() => {
    onChange(elegido && !lleno
      ? { campaign: elegido.campaign, tipoCurso: elegido.tipoCurso, horarioCurso: elegido.horarioCurso, salon: elegido.salon || '' }
      : null)
    // onChange se omite a propósito: suele ser una función nueva en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elegido, lleno])

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="sd-campana" className="block text-sm font-medium text-gray-700 mb-1">Campaña</label>
        <select id="sd-campana" value={campaign} onChange={e => { setCampaign(e.target.value); setTipoCurso(''); setRowKey('') }}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
          <option value="">-- Selecciona campaña --</option>
          {campanias.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="sd-curso" className="block text-sm font-medium text-gray-700 mb-1">Curso</label>
        <select id="sd-curso" value={tipoCurso} disabled={!campaign} onChange={e => { setTipoCurso(e.target.value); setRowKey('') }}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm disabled:bg-gray-100">
          <option value="">-- Selecciona curso --</option>
          {tipos.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="sd-salon" className="block text-sm font-medium text-gray-700 mb-1">Salón / Horario (cupo)</label>
        <select id="sd-salon" value={rowKey} disabled={!tipoCurso} onChange={e => setRowKey(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm disabled:bg-gray-100">
          <option value="">-- Selecciona salón --</option>
          {salones.map(r => {
            const full = r.numeroUsuarios > 0 && (r.usuInscritos ?? 0) >= r.numeroUsuarios
            return (
              <option key={`${r.horarioCurso}||${r.salon || ''}`} value={`${r.horarioCurso}||${r.salon || ''}`} disabled={full}>
                {r.salon || '—'} · {r.horarioCurso} · {r.usuInscritos ?? 0}/{r.numeroUsuarios ?? 0}{full ? ' (LLENO)' : ''}
              </option>
            )
          })}
        </select>
        {elegido && (
          <p className={`text-xs mt-1 ${lleno ? 'text-red-600' : 'text-green-600'}`}>
            {lleno ? 'Este salón está lleno — elige otro.' : `Cupo disponible: ${(elegido.numeroUsuarios - (elegido.usuInscritos ?? 0))} libre(s).`}
          </p>
        )}
      </div>
    </div>
  )
}
