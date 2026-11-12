'use client'

/**
 * /admin/link-sesion — Mantenimiento › Usuarios › Link de sesión.
 *
 * Pide el ID del estudiante, muestra su próxima sesión de HOY (campaña, curso,
 * salón, guía y link de Zoom) y permite enviar ese link por WhatsApp al
 * apoderado, por contingencia. Si el apoderado no tiene teléfono válido se puede
 * digitar o corregir el número antes de enviar.
 *
 * Permiso: MANTENIMIENTO.USUARIOS.ENVIO_LINK_CONTINGENCIA (SUPER_ADMIN/ADMIN bypass).
 */

import { useState } from 'react'
import { MagnifyingGlassIcon, PaperAirplaneIcon, LinkIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

interface Resultado {
  estudiante: { academicaId: string; numeroId: string; nombre: string; campana: string; curso: string; salon: string; horario: string; contrato: string }
  apoderado: { nombre: string; telefono: string }
  sesion: { eventoId: string; fechaEvento: string; fin: string; tipo: string; leccion: string; guia: string; link: string } | null
  motivoSinSesion: string | null
  avisos: string[]
  yaEnviado: { fecha: string; por: string } | null
}

const TZ = 'America/Santiago'
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short', timeZone: TZ })

function Dato({ k, v }: { k: string; v?: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400 uppercase font-semibold mb-0.5">{k}</p>
      <p className="text-gray-800 text-sm">{v || '—'}</p>
    </div>
  )
}

export default function LinkSesionPage() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [res, setRes] = useState<Resultado | null>(null)
  const [telefono, setTelefono] = useState('')
  const [confirmar, setConfirmar] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState<string | null>(null)

  const buscar = async () => {
    const val = input.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
    if (!val) { toast.error('Ingrese el ID del estudiante'); return }
    setLoading(true); setRes(null); setEnviado(null); setConfirmar(false)
    try {
      const r = await fetch(`/api/admin/link-sesion?numeroId=${encodeURIComponent(val)}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.success) throw new Error(j.error || 'No se pudo consultar')
      setRes(j.resultado)
      setTelefono(j.resultado.apoderado.telefono || '')
    } catch (e: any) {
      toast.error(e?.message || 'Error al consultar')
    } finally { setLoading(false) }
  }

  const tel = telefono.replace(/\D/g, '')
  const telOk = tel.length >= 10 && tel.length <= 15

  const enviar = async () => {
    if (!res) return
    setEnviando(true)
    try {
      const r = await fetch('/api/admin/link-sesion/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numeroId: res.estudiante.numeroId, telefono: tel, confirmarReenvio: !!res.yaEnviado }),
      })
      const j = await r.json()
      if (!r.ok || !j.success) throw new Error(j.error || 'No se pudo enviar')
      setEnviado(tel); setConfirmar(false)
      toast.success('Link enviado por WhatsApp')
    } catch (e: any) {
      toast.error(e?.message || 'Error al enviar')
    } finally { setEnviando(false) }
  }

  const s = res?.sesion

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3">
        <LinkIcon className="h-6 w-6 text-primary-600" />
        <h1 className="text-xl font-bold text-gray-900">Link de sesión (contingencia)</h1>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
          Muestra la <strong>próxima sesión de hoy</strong> del estudiante y envía su link de Zoom por WhatsApp al
          apoderado. Úselo sólo cuando el estudiante no pueda entrar por la plataforma. Cada envío queda registrado.
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-3">
          <label htmlFor="ls-id" className="text-sm font-semibold text-gray-700">ID del estudiante (sin puntos ni guion)</label>
          <div className="flex gap-2">
            <input id="ls-id" type="text" value={input}
              onChange={e => { setInput(e.target.value.replace(/[^0-9A-Za-z]/g, '').toUpperCase()); setRes(null); setEnviado(null) }}
              onKeyDown={e => e.key === 'Enter' && buscar()}
              placeholder="154347275"
              className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500" />
            <button type="button" onClick={buscar} disabled={loading}
              className="px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2 text-sm font-medium">
              {loading ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <MagnifyingGlassIcon className="h-4 w-4" />}
              Buscar
            </button>
          </div>
        </div>

        {res && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-primary-600 px-6 py-4">
              <p className="text-xs text-primary-100 uppercase font-semibold tracking-wide mb-1">Estudiante</p>
              <p className="text-white font-bold text-lg">{res.estudiante.nombre}</p>
            </div>
            <div className="px-6 py-5 space-y-5">
              {res.avisos.map(a => (
                <div key={a} className="bg-red-50 border border-red-300 rounded-lg px-4 py-3 text-sm font-semibold text-red-700">⚠ {a}</div>
              ))}

              <div className="grid grid-cols-2 gap-4">
                <Dato k="Campaña" v={res.estudiante.campana} />
                <Dato k="Curso" v={res.estudiante.curso} />
                <Dato k="Salón" v={res.estudiante.salon} />
                <Dato k="Contrato" v={res.estudiante.contrato} />
              </div>

              {!s ? (
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-700">{res.motivoSinSesion}</div>
              ) : (
                <>
                  <div className="border-t pt-4 grid grid-cols-2 gap-4">
                    <Dato k="Próxima sesión de hoy" v={`${hora(s.fechaEvento)} – ${hora(s.fin)} (hora de Chile)`} />
                    <Dato k="Lección" v={s.leccion} />
                    <Dato k="Guía" v={s.guia} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 uppercase font-semibold mb-0.5">Link de la sesión</p>
                    {s.link
                      ? <a href={s.link} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline break-all">{s.link}</a>
                      : <p className="text-sm text-red-600 font-semibold">La sala del guía no tiene link de Zoom cargado: no hay nada que enviar.</p>}
                  </div>

                  {s.link && (
                    <div className="border-t pt-4 space-y-3">
                      <div>
                        <label htmlFor="ls-tel" className="text-sm font-semibold text-gray-700">
                          WhatsApp del apoderado{res.apoderado.nombre ? ` (${res.apoderado.nombre})` : ''}
                        </label>
                        <input id="ls-tel" type="text" inputMode="numeric" value={telefono}
                          onChange={e => { setTelefono(e.target.value.replace(/\D/g, '')); setEnviado(null) }}
                          placeholder="56912345678"
                          className="mt-1 w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500" />
                        <p className="text-xs text-gray-500 mt-1">
                          {res.apoderado.telefono.length >= 10
                            ? 'Precargado desde la ficha. Puede corregirlo antes de enviar.'
                            : 'El apoderado no tiene un teléfono válido registrado: digítelo con el indicativo del país (solo números).'}
                        </p>
                      </div>
                      {res.yaEnviado && (
                        <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 text-sm text-amber-900">
                          El link de esta sesión ya se envió el {fechaHora(res.yaEnviado.fecha)} por {res.yaEnviado.por || 'un usuario'}. Si lo envía de nuevo, quedará otro registro.
                        </div>
                      )}
                      {enviado ? (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800">✓ Link enviado al {enviado}.</div>
                      ) : (
                        <button type="button" onClick={() => setConfirmar(true)} disabled={!telOk}
                          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 font-semibold text-sm">
                          <PaperAirplaneIcon className="h-5 w-5" />
                          {res.yaEnviado ? 'Reenviar link por WhatsApp' : 'Enviar link por WhatsApp'}
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {confirmar && res && s && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
            <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl space-y-3">
              <h3 className="text-lg font-semibold text-gray-900">Confirmar envío</h3>
              <p className="text-sm text-gray-700">
                Se enviará el link de <strong>{res.estudiante.nombre}</strong> por WhatsApp al número{' '}
                <strong className="font-mono">{tel}</strong>.
              </p>
              <div className="bg-gray-50 border rounded p-3 text-xs text-gray-700 whitespace-pre-line">
                {`Estimado apoderado${res.apoderado.nombre ? ` ${res.apoderado.nombre}` : ''}, a continuación le enviamos el link de acceso a la sesión de ${res.estudiante.nombre.split(' ')[0]}, que se le envía por contingencia.\n\n${s.link}\n\nSi tiene dudas sobre el procedimiento regular de ingreso a la plataforma y acceso a las sesiones del curso ${res.estudiante.curso}, solicite soporte a este número.`}
              </div>
              {res.avisos.length > 0 && <p className="text-xs font-semibold text-red-600">Recuerde: {res.avisos.join(' ')}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setConfirmar(false)} disabled={enviando}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50">Cancelar</button>
                <button type="button" onClick={enviar} disabled={enviando}
                  className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded hover:bg-emerald-700 disabled:opacity-50">
                  {enviando ? 'Enviando…' : 'Sí, enviar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
