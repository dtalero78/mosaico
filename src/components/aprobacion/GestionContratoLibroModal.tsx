'use client'

/**
 * Libro de Producción › modal de una casilla de contrato.
 *   - Depurar: descargar el ZIP (documentos, recibo, contrato) y BORRAR el contrato.
 *   - Ratificar: contrato sin firma + correo del "Sí, acepto" → queda firmado y listo.
 */
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { XMarkIcon, ArrowDownTrayIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { api } from '@/hooks/use-api'
import { usePermissions } from '@/hooks/usePermissions'
import { AprobacionPermission } from '@/types/permissions'
import { ACCEPT_DOCUMENTOS } from '@/lib/documentos-adjuntos'

interface Analisis {
  titularId: string; contrato: string; titular: string
  firmado: boolean; aprobado: boolean; finalizado: boolean; listo: boolean
  enMatricula: boolean; campanias: string[]
  documentos: { nombre: string; url: string; origen: string }[]
  alumnos: number; clases: number
  otrosContratos: { contrato: string; persona: string; rol: string }[]
  puedeDepurar: { ok: boolean; motivo?: string }
  puedeRatificar: { ok: boolean; motivo?: string }
}

async function postJson(url: string, body: any) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j?.error || j?.message || `Error ${res.status}`)
  return j
}

export default function GestionContratoLibroModal({ titularId, onClose, onDone }: {
  titularId: string; onClose: () => void; onDone: () => void
}) {
  const { hasPermission } = usePermissions()
  const puedeDepurar = hasPermission(AprobacionPermission.LIBRO_PRODUCCION_DEPURAR)
  const puedeRatificar = hasPermission(AprobacionPermission.LIBRO_PRODUCCION_RATIFICAR)
  const [a, setA] = useState<Analisis | null>(null)
  const [err, setErr] = useState('')
  const [accion, setAccion] = useState<'depurar' | 'ratificar'>('depurar')
  const [descargado, setDescargado] = useState(false)
  const [bajando, setBajando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [confirmaOtros, setConfirmaOtros] = useState(false)
  const [doc, setDoc] = useState<{ url: string; nombre: string; tipo: string } | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [trabajando, setTrabajando] = useState(false)

  useEffect(() => {
    api.get<{ analisis: Analisis }>(`/api/postgres/libro-produccion/${titularId}/gestion`)
      .then(d => {
        setA(d.analisis)
        if (!d.analisis.puedeRatificar.ok || !puedeRatificar) setAccion('depurar')
        else if (!puedeDepurar) setAccion('ratificar')
        else setAccion(d.analisis.firmado ? 'depurar' : 'ratificar')
      })
      .catch((e: any) => setErr(e?.message || 'No se pudo cargar el contrato'))
  }, [titularId, puedeDepurar, puedeRatificar])

  const descargarZip = async () => {
    setBajando(true)
    try {
      const res = await fetch(`/api/postgres/libro-produccion/${titularId}/zip`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Error ${res.status}`)
      const blob = await res.blob()
      const nombre = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || `${a?.contrato}.zip`
      const u = URL.createObjectURL(blob)
      const el = document.createElement('a'); el.href = u; el.download = nombre; document.body.appendChild(el); el.click(); el.remove()
      URL.revokeObjectURL(u)
      setDescargado(true)
      toast.success('ZIP descargado')
    } catch (e: any) { toast.error(e?.message || 'No se pudo generar el ZIP') } finally { setBajando(false) }
  }

  const subir = async (file: File) => {
    setSubiendo(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch(`/api/contracts/${titularId}/upload-url`, { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error || `Error ${res.status}`)
      setDoc({ url: j.publicUrl, nombre: file.name, tipo: file.type })
    } catch (e: any) { toast.error(e?.message || 'No se pudo subir el archivo') } finally { setSubiendo(false) }
  }

  const otros = a?.otrosContratos || []
  const depurar = async () => {
    if (!window.confirm(`¿Depurar el contrato ${a?.contrato}? Se BORRAN sus registros (queda copia en el registro de purgas).`)) return
    setTrabajando(true)
    try {
      await postJson(`/api/postgres/libro-produccion/${titularId}/depurar`, { motivo, confirmoDescarga: descargado, confirmarOtros: confirmaOtros })
      toast.success(`Contrato ${a?.contrato} depurado`); onDone(); onClose()
    } catch (e: any) { toast.error(e?.message || 'No se pudo depurar') } finally { setTrabajando(false) }
  }
  const ratificar = async () => {
    setTrabajando(true)
    try {
      const j = await postJson(`/api/postgres/libro-produccion/${titularId}/ratificar`, { documento: doc, confirmarOtros: confirmaOtros })
      const r = j.resultado
      if (r.listo) toast.success(`Contrato ${a?.contrato} ratificado y listo para aprobar`)
      else toast(`Ratificado, pero no quedó listo: ${r.avisoListo}`, { icon: '⚠️', duration: 9000 })
      onDone(); onClose()
    } catch (e: any) { toast.error(e?.message || 'No se pudo ratificar') } finally { setTrabajando(false) }
  }

  const AlertaOtros = () => otros.length ? (
    <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="flex items-center gap-1.5 font-semibold"><ExclamationTriangleIcon className="h-4 w-4" /> Estas personas tienen otros contratos</p>
      <ul className="mt-1 list-disc pl-5 text-xs">
        {otros.map((o, i) => <li key={i}>{o.persona} ({o.rol.toLowerCase()}) — contrato <b>{o.contrato}</b></li>)}
      </ul>
      <label className="mt-2 flex items-start gap-2 text-xs">
        <input type="checkbox" checked={confirmaOtros} onChange={e => setConfirmaOtros(e.target.checked)} className="mt-0.5" />
        Entiendo que existen esos otros contratos y confirmo {accion === 'depurar' ? 'la depuración (esas personas se conservan en sus otros contratos)' : 'la ratificación'}.
      </label>
    </div>
  ) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Gestionar contrato {a?.contrato || ''}</h2>
            {a && <p className="text-sm text-gray-500">{a.titular} · {a.firmado ? 'Firmado' : 'Sin firmar'}{a.aprobado ? ' · Aprobado' : a.listo ? ' · Listo' : ''}</p>}
          </div>
          <button type="button" onClick={onClose} title="Cerrar" className="text-gray-400 hover:text-gray-700"><XMarkIcon className="h-5 w-5" /></button>
        </div>

        {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
        {!a && !err && <p className="mt-6 text-center text-sm text-gray-400 italic">Cargando…</p>}

        {a && (
          <div className="mt-4 space-y-4">
            <div className="flex gap-2 border-b border-gray-200">
              {puedeRatificar && (
                <button type="button" onClick={() => { setAccion('ratificar'); setConfirmaOtros(false) }}
                  className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px ${accion === 'ratificar' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500'}`}>
                  Ratificar por correo
                </button>
              )}
              {puedeDepurar && (
                <button type="button" onClick={() => { setAccion('depurar'); setConfirmaOtros(false) }}
                  className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px ${accion === 'depurar' ? 'border-red-600 text-red-700' : 'border-transparent text-gray-500'}`}>
                  Depurar
                </button>
              )}
            </div>

            {accion === 'depurar' ? (
              !a.puedeDepurar.ok ? (
                <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{a.puedeDepurar.motivo}</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-gray-700">
                    Depurar <b>borra</b> el contrato con sus registros (personas, financiero, pagos, accesos y clases). Antes, descargue los documentos y recibos.
                  </p>
                  {a.aprobado && (
                    <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                      Contrato <b>aprobado</b> (curso aún en matrícula): se borran <b>{a.alumnos}</b> alumno(s) y <b>{a.clases}</b> clase(s) agendada(s).
                    </div>
                  )}
                  <div className="rounded-lg border border-gray-200 p-3">
                    <p className="text-xs font-semibold text-gray-600">Archivos del ZIP ({a.documentos.length} adjunto(s) + contrato en PDF)</p>
                    <ul className="mt-1 list-disc pl-5 text-xs text-gray-600">
                      {a.documentos.map((d, i) => <li key={i}>{d.origen === 'recibo' ? 'Recibo: ' : ''}{d.nombre}</li>)}
                      {!a.documentos.length && <li className="italic">Sin documentos adjuntos</li>}
                    </ul>
                    <button type="button" onClick={descargarZip} disabled={bajando}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                      <ArrowDownTrayIcon className="h-4 w-4" /> {bajando ? 'Generando…' : descargado ? 'Descargar de nuevo' : 'Descargar ZIP'}
                    </button>
                    {descargado && <span className="ml-2 text-xs font-semibold text-green-700">✓ Descargado</span>}
                  </div>
                  <AlertaOtros />
                  <label className="block text-xs text-gray-600">Motivo (obligatorio)
                    <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
                      className="mt-0.5 w-full rounded-md border border-gray-300 p-2 text-sm" placeholder="Ej.: contrato duplicado por error del ejecutivo" />
                  </label>
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700">Cancelar</button>
                    <button type="button" onClick={depurar}
                      disabled={trabajando || !descargado || !motivo.trim() || (otros.length > 0 && !confirmaOtros)}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40">
                      {trabajando ? 'Depurando…' : 'Aceptar y depurar'}
                    </button>
                  </div>
                  {!descargado && <p className="text-right text-[11px] text-gray-400">Se habilita al descargar el ZIP.</p>}
                </div>
              )
            ) : (
              !a.puedeRatificar.ok ? (
                <p className="rounded-lg border border-gray-300 bg-gray-50 p-3 text-sm text-gray-700">{a.puedeRatificar.motivo}</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-gray-700">
                    El contrato no está firmado. Anexe el <b>correo del “Sí, acepto”</b> del titular: quedará firmado con la leyenda
                    <i> “Aceptación realizada por medio de correo electrónico adjuntado a los documentos”</i> y listo para aprobar.
                  </p>
                  <div className="rounded-lg border border-gray-200 p-3">
                    <input type="file" accept={ACCEPT_DOCUMENTOS} disabled={subiendo}
                      onChange={e => { const f = e.target.files?.[0]; if (f) subir(f) }} className="text-sm" />
                    {subiendo && <p className="mt-1 text-xs text-gray-500">Subiendo…</p>}
                    {doc && <p className="mt-1 text-xs font-semibold text-green-700">✓ Adjunto: {doc.nombre}</p>}
                  </div>
                  <AlertaOtros />
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700">Cancelar</button>
                    <button type="button" onClick={ratificar} disabled={trabajando || !doc || (otros.length > 0 && !confirmaOtros)}
                      className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
                      {trabajando ? 'Ratificando…' : 'Aceptar y ratificar'}
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}
