'use client'

import { useEffect, useState } from 'react'

/**
 * "Reportar a <alumno>" — el punto donde NACE un reporte (R1).
 *
 * Si el alumno ya tiene casos abiertos, el backend rechaza el envío sin destino
 * y devuelve la lista; entonces este modal pregunta si el reporte suma al caso
 * abierto o abre uno nuevo (R2). Sin casos abiertos se envía derecho.
 */

const TEMAS = [
  { id: 'ASISTENCIA', label: 'Asistencia' },
  { id: 'CONDUCTA', label: 'Conducta' },
  { id: 'DESEMPENO', label: 'Desempeño' },
  { id: 'SALUD', label: 'Salud' },
  { id: 'PAGO', label: 'Pago' },
  { id: 'OTRO', label: 'Otro' },
]

interface CasoAbierto {
  _id: string
  codigo: string
  tema: string
  diasAbierto: number
  reportes: number
  ultimaGestion: string | null
}

export default function ReportarCasoModal({
  academicaId, alumno, eventoId, bookingId, sesionLabel, onClose, onEnviado,
}: {
  academicaId: string
  alumno: string
  eventoId?: string | null
  bookingId?: string | null
  sesionLabel?: string
  onClose: () => void
  onEnviado?: (r: { codigo: string; abrioCaso: boolean }) => void
}) {
  const [texto, setTexto] = useState('')
  const [tema, setTema] = useState('ASISTENCIA')
  const [abiertos, setAbiertos] = useState<CasoAbierto[]>([])
  const [destino, setDestino] = useState<string>('')   // casoId | 'nuevo'
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Se consultan al abrir para poder mostrar el aviso ANTES de escribir, no
  // sólo al chocar contra el rechazo del backend.
  useEffect(() => {
    let vivo = true
    fetch(`/api/postgres/casos-atencion/reportes?academicaId=${encodeURIComponent(academicaId)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        if (!vivo || !j?.success) return
        setAbiertos(j.casosAbiertos || [])
        // Sumar al caso abierto es lo habitual: suele ser la misma situación.
        if (j.casosAbiertos?.length) setDestino(j.casosAbiertos[0]._id)
      })
      .catch(() => { /* el backend vuelve a validar al enviar */ })
    return () => { vivo = false }
  }, [academicaId])

  const enviar = async () => {
    if (!texto.trim()) { setErr('Escribe el reporte.'); return }
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/postgres/casos-atencion/reportes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          academicaId, texto, tema, eventoId: eventoId ?? null, bookingId: bookingId ?? null,
          destino: abiertos.length ? (destino || 'nuevo') : null,
        }),
      })
      const j = await res.json()
      if (!j?.success) {
        // Si el alumno abrió un caso mientras el modal estaba abierto, el
        // backend lo devuelve y se pregunta en vez de fallar.
        if (j?.detail?.tipo === 'caso_abierto') {
          setAbiertos(j.detail.casosAbiertos || [])
          setDestino(j.detail.casosAbiertos?.[0]?._id || 'nuevo')
          setErr('El alumno tiene un caso abierto: indica dónde va este reporte.')
          return
        }
        setErr(j?.error || 'No se pudo enviar el reporte.')
        return
      }
      onEnviado?.({ codigo: j.codigo, abrioCaso: j.abrioCaso })
      onClose()
    } catch (e: any) {
      setErr(e?.message || 'Error de red.')
    } finally { setBusy(false) }
  }

  const caso = abiertos[0]

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto">
        {sesionLabel && <p className="text-xs text-gray-500">{sesionLabel}</p>}
        <h3 className="text-xl font-semibold text-gray-900">Reportar a {alumno}</h3>

        <textarea
          value={texto} onChange={e => setTexto(e.target.value)} rows={4} autoFocus
          placeholder="Describe qué pasó en la sesión…"
          className="mt-4 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
        />

        {/* Aviso + decisión de destino (R2) */}
        {caso && (
          <>
            <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-4">
              <p className="font-medium text-amber-800">Ya hay un caso abierto</p>
              <p className="text-sm text-amber-700 mt-1">
                {caso.codigo} · {(TEMAS.find(t => t.id === caso.tema)?.label || caso.tema).toLowerCase()} ·
                {' '}abierto hace {caso.diasAbierto} día(s), {caso.reportes} reporte(s).
                {caso.ultimaGestion && <> Última gestión: {caso.ultimaGestion}.</>}
              </p>
            </div>

            <p className="mt-4 text-sm text-gray-600">¿Dónde va este reporte?</p>
            <div className="mt-2 space-y-2">
              {abiertos.map(c => (
                <label key={c._id}
                  className={`flex gap-3 p-3 rounded-lg border cursor-pointer ${destino === c._id
                    ? 'border-primary-500 ring-1 ring-primary-500 bg-primary-50/40'
                    : 'border-gray-200 hover:bg-gray-50'}`}>
                  <input type="radio" name="destino" checked={destino === c._id}
                    onChange={() => setDestino(c._id)} className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium text-gray-900">
                      Sumar al caso abierto{abiertos.length > 1 && ` ${c.codigo}`}
                    </span>
                    <span className="block text-xs text-gray-500">Es la misma situación que ya se está gestionando</span>
                  </span>
                </label>
              ))}
              <label className={`flex gap-3 p-3 rounded-lg border cursor-pointer ${destino === 'nuevo'
                ? 'border-primary-500 ring-1 ring-primary-500 bg-primary-50/40'
                : 'border-gray-200 hover:bg-gray-50'}`}>
                <input type="radio" name="destino" checked={destino === 'nuevo'}
                  onChange={() => setDestino('nuevo')} className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium text-gray-900">Abrir un caso nuevo</span>
                  <span className="block text-xs text-gray-500">Es otro tema, sin relación con el anterior</span>
                </span>
              </label>
            </div>
          </>
        )}

        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

        <div className="mt-5 flex items-center justify-between gap-3">
          <select value={tema} onChange={e => setTema(e.target.value)}
            title="Tema del reporte" aria-label="Tema del reporte"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {TEMAS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy}
              className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
              Cancelar
            </button>
            <button type="button" onClick={enviar} disabled={busy || !texto.trim()}
              className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm hover:bg-primary-700 disabled:opacity-50">
              {busy ? 'Enviando…' : 'Enviar reporte'}
            </button>
          </div>
        </div>

        <p className="mt-3 text-xs text-gray-400">
          El reporte no se puede editar ni borrar una vez enviado: las correcciones se hacen con otro reporte.
        </p>
      </div>
    </div>
  )
}
