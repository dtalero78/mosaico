'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'

interface Taller { bookingId: string; eventoId: string; dia: string; titulo: string | null; guia: string | null }
interface Alumno { academicaId: string; nombre: string; numeroId: string | null; curso: string | null; campaign: string | null; salon: string | null; contrato: string | null }
interface Destino { eventoId: string; dia: string; titulo: string; guia: string | null; inscritos: number; cupo: number; libres: number | null; cabe: boolean }

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('es-CL', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

const API = '/api/postgres/servicio/talleres/gestion-usuario'
async function post(body: Record<string, any>) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok && !j.error, j }
}

/**
 * Talleres › Gestión usuario: pide el ID del alumno, muestra sus talleres PRÓXIMOS y
 * permite sacarlo (cancela su agendamiento) o trasladarlo a otro taller con cupo.
 * Motivo obligatorio; todo queda registrado (quién, cuándo, por qué).
 */
export default function GestionUsuarioTaller({ onChanged }: { onChanged?: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [documento, setDocumento] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [alumno, setAlumno] = useState<Alumno | null>(null)
  const [talleres, setTalleres] = useState<Taller[]>([])
  const [bookingId, setBookingId] = useState('')
  const [accion, setAccion] = useState<'' | 'sacar' | 'trasladar'>('')
  const [destinos, setDestinos] = useState<Destino[]>([])
  const [destinoId, setDestinoId] = useState('')
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cerrar = () => {
    setAbierto(false); setDocumento(''); setAlumno(null); setTalleres([]); setBookingId('')
    setAccion(''); setDestinos([]); setDestinoId(''); setMotivo('')
  }

  const buscar = async () => {
    if (!documento.trim()) return
    setBuscando(true); setAlumno(null); setTalleres([]); setBookingId(''); setAccion('')
    const { ok, j } = await post({ accion: 'buscar', documento: documento.trim() })
    setBuscando(false)
    if (!ok) { toast.error(j.error || 'No se encontró al alumno'); return }
    setAlumno(j.alumno); setTalleres(j.talleres || [])
    if ((j.talleres || []).length === 1) setBookingId(j.talleres[0].bookingId)
  }

  const elegirAccion = async (a: 'sacar' | 'trasladar') => {
    setAccion(a); setMotivo(''); setDestinoId(''); setDestinos([])
    if (a === 'trasladar') {
      const { ok, j } = await post({ accion: 'destinos', bookingId })
      if (!ok) { toast.error(j.error || 'No se pudieron cargar los destinos'); setAccion(''); return }
      setDestinos(j.destinos || [])
    }
  }

  const confirmar = async () => {
    if (!accion || !bookingId || !motivo.trim()) return
    setGuardando(true)
    const { ok, j } = await post(accion === 'sacar'
      ? { accion: 'sacar', bookingId, motivo: motivo.trim() }
      : { accion: 'trasladar', bookingId, destinoEventoId: destinoId, motivo: motivo.trim() })
    setGuardando(false)
    if (!ok) { toast.error(j.error || 'No se pudo completar'); return }
    toast.success(accion === 'sacar' ? 'Alumno sacado del taller' : 'Alumno trasladado al otro taller')
    cerrar(); onChanged?.()
  }

  const taller = talleres.find(t => t.bookingId === bookingId)

  return (
    <>
      <button type="button" onClick={() => setAbierto(true)}
        className="px-3 py-2 text-sm bg-orange-100 text-orange-800 rounded-lg hover:bg-orange-200 font-medium">
        Gestión usuario
      </button>

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-auto p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Gestión usuario · Talleres</h3>

            <label htmlFor="gu-doc" className="block text-xs font-medium text-gray-600 mb-1">ID del alumno</label>
            <div className="flex gap-2 mb-4">
              <input id="gu-doc" value={documento} onChange={e => setDocumento(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') buscar() }} placeholder="Documento, con o sin puntos y guion"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <button type="button" onClick={buscar} disabled={buscando || !documento.trim()}
                className="px-4 py-2 text-sm font-semibold text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50">
                {buscando ? 'Buscando…' : 'Buscar'}
              </button>
            </div>

            {alumno && (
              <div className="mb-4">
                <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm">
                  <div className="font-semibold text-gray-900">{alumno.nombre}</div>
                  <div className="text-xs text-gray-500">
                    {alumno.numeroId} · {alumno.curso || '—'}{alumno.salon ? ` · Salón ${alumno.salon}` : ''}{alumno.contrato ? ` · ${alumno.contrato}` : ''}
                  </div>
                </div>

                {talleres.length === 0 ? (
                  <p className="mt-3 text-sm text-amber-700">No está inscrito en ningún taller próximo.</p>
                ) : (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-gray-600 mb-1">Talleres próximos</div>
                    <ul className="space-y-1">
                      {talleres.map(t => (
                        <li key={t.bookingId}>
                          <label className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm cursor-pointer ${bookingId === t.bookingId ? 'border-primary-500 bg-primary-50' : 'border-gray-200'}`}>
                            <input type="radio" name="gu-taller" checked={bookingId === t.bookingId}
                              onChange={() => { setBookingId(t.bookingId); setAccion('') }} />
                            <span><b>{fmt(t.dia)}</b> · {t.titulo || 'Taller'}{t.guia ? ` · ${t.guia}` : ''}</span>
                          </label>
                        </li>
                      ))}
                    </ul>

                    {bookingId && (
                      <div className="mt-3 flex gap-2">
                        <button type="button" onClick={() => elegirAccion('sacar')}
                          className={`px-3 py-1.5 text-sm font-semibold rounded-lg border ${accion === 'sacar' ? 'bg-red-600 text-white border-red-600' : 'text-red-700 border-red-300 hover:bg-red-50'}`}>
                          Remover del taller
                        </button>
                        <button type="button" onClick={() => elegirAccion('trasladar')}
                          className={`px-3 py-1.5 text-sm font-semibold rounded-lg border ${accion === 'trasladar' ? 'bg-primary-600 text-white border-primary-600' : 'text-primary-700 border-primary-300 hover:bg-primary-50'}`}>
                          Mover a otro taller
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {accion === 'trasladar' && (
                  <div className="mt-3">
                    <label htmlFor="gu-dest" className="block text-xs font-medium text-gray-600 mb-1">Taller de destino</label>
                    {destinos.length === 0 ? (
                      <p className="text-sm text-amber-700">No hay otro taller futuro de su curso al que moverlo.</p>
                    ) : (
                      <select id="gu-dest" value={destinoId} onChange={e => setDestinoId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                        <option value="">Elige el taller…</option>
                        {destinos.map(d => (
                          <option key={d.eventoId} value={d.eventoId} disabled={!d.cabe}>
                            {fmt(d.dia)} · {d.titulo}{d.guia ? ` · ${d.guia}` : ''} · {d.inscritos}/{d.cupo || '∞'}{d.cabe ? '' : ' (sin cupo)'}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {accion && (
                  <div className="mt-3">
                    <p className="text-xs text-gray-600 mb-2">
                      {accion === 'sacar'
                        ? <>Se cancelará el agendamiento de <b>{alumno.nombre}</b> al taller del <b>{taller ? fmt(taller.dia) : ''}</b>.</>
                        : <>Se cancelará su agendamiento actual y se agendará en el taller elegido.</>}
                    </p>
                    <label htmlFor="gu-motivo" className="block text-xs font-medium text-gray-600 mb-1">Motivo (obligatorio)</label>
                    <textarea id="gu-motivo" value={motivo} onChange={e => setMotivo(e.target.value)} rows={2} maxLength={500}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={cerrar} disabled={guardando}
                className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cerrar</button>
              {accion && (
                <button type="button" onClick={confirmar}
                  disabled={guardando || !motivo.trim() || (accion === 'trasladar' && !destinoId)}
                  className={`px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 ${accion === 'sacar' ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-600 hover:bg-primary-700'}`}>
                  {guardando ? 'Guardando…' : 'Confirmar'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
