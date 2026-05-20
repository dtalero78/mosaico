'use client'

import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { XMarkIcon, ArrowUpTrayIcon, TrashIcon } from '@heroicons/react/24/outline'
import { api, handleApiError } from '@/hooks/use-api'

interface PagoTitularWizardProps {
  isOpen: boolean
  onClose: () => void
  /** Titular del contrato — proveedor de defaults (numeroId, plataforma, gestorRecaudo) */
  titular: {
    _id: string
    numeroId?: string
    plataforma?: string
    gestorRecaudo?: string | null
    primerNombre?: string
    primerApellido?: string
  }
  /** Display label of gestor recaudo to show in read-only field. */
  gestorLabel?: string | null
  /** Lista de pagos existentes del titular — usado para auto-populate:
   *  - `vlrTotalProg`/`valorCuota` ← cuota #0
   *  - `numCuota` ← max(numCuota) + 1
   *  - `fechaVencimiento` ← último pago.fechaPago + 1 mes */
  existingPagos?: any[]
  /** Llamado tras crear pago exitosamente para refrescar la lista padre. */
  onCreated: () => void
}

interface DocAdjunto {
  url: string
  nombre: string
  tipo?: string
  fechaSubida?: string
}

interface DraftState {
  fechaPago: string
  fechaVencimiento: string
  plan: string
  vlrTotalProg: string
  numCuota: string
  valorCuota: string
  valorPagado: string
  descuento: string
  medioPago: string
  numeroReferencia: string
  pagoTercero: string
  idTercero: string
  plataforma: string
  documentosAdjuntos: DocAdjunto[]
}

const DRAFT_TTL_MS = 72 * 60 * 60 * 1000 // 72 horas

const empty = (): DraftState => ({
  fechaPago: new Date().toISOString().slice(0, 10),
  fechaVencimiento: '',
  plan: '',
  vlrTotalProg: '',
  numCuota: '',
  valorCuota: '',
  valorPagado: '',
  descuento: '',
  medioPago: '',
  numeroReferencia: '',
  pagoTercero: '',
  idTercero: '',
  plataforma: '',
  documentosAdjuntos: [],
})

function toNum(v: string): number {
  if (!v) return 0
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** YYYY-MM-DD + 1 mes → YYYY-MM-DD. Maneja overflow (Ene 31 → Feb 28/29). */
function addOneMonth(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const ymd = String(dateStr).slice(0, 10)
  const parts = ymd.split('-').map(Number)
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return ''
  const [y, m, d] = parts
  // Trabajamos en UTC para evitar drift por timezone
  const target = new Date(Date.UTC(y, m, d)) // m ya es 0-indexed + 1 (queremos mes siguiente)
  // Si el día se "rebalsó" (Ene 31 → Mar 3), retrocedemos al último día del mes objetivo
  if (target.getUTCMonth() !== ((m) % 12)) {
    target.setUTCDate(0)
  }
  return target.toISOString().slice(0, 10)
}

function formatMoney(v: string): string {
  if (!v) return ''
  const num = toNum(v)
  if (num === 0) return ''
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(num)
}

function MoneyInput({
  id, label, value, onChange, required = false, readOnly = false,
}: { id: string; label: string; value: string; onChange: (v: string) => void; required?: boolean; readOnly?: boolean }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      <div className="relative mt-1">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          readOnly={readOnly}
          tabIndex={readOnly ? -1 : 0}
          value={value === '' ? '' : formatMoney(value)}
          onChange={e => {
            if (readOnly) return
            const cleaned = e.target.value.replace(/[^0-9]/g, '')
            onChange(cleaned)
          }}
          className={
            `w-full pl-7 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500 ` +
            (readOnly ? 'bg-gray-100 text-gray-600 cursor-not-allowed' : '')
          }
          placeholder="0"
        />
      </div>
    </div>
  )
}

export default function PagoTitularWizard({
  isOpen, onClose, titular, gestorLabel, existingPagos, onCreated,
}: PagoTitularWizardProps) {
  const draftKey = `pago-titular-draft-${titular._id}`
  const [form, setForm] = useState<DraftState>(empty())
  const [submitting, setSubmitting] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([])
  const [showDraftBanner, setShowDraftBanner] = useState(false)
  const draftRestored = useRef(false)
  const saveTimer = useRef<NodeJS.Timeout | null>(null)

  // Defaults auto-poblados desde pagos existentes:
  //  - cuota#0 → vlrTotalProg + valorCuota (referencia del contrato)
  //  - max(numCuota)+1 → próxima cuota
  //  - último pago.fechaPago + 1 mes → próxima fechaVencimiento
  const computeAutoDefaults = (): Partial<DraftState> => {
    const list = Array.isArray(existingPagos) ? existingPagos : []
    if (list.length === 0) return {}
    const cuotaCero = list.find((p: any) => Number(p.numCuota) === 0)
    const maxCuota = list.reduce((max: number, p: any) => {
      const n = Number(p.numCuota)
      return Number.isFinite(n) && n > max ? n : max
    }, -1)
    // Ordenar por fechaPago desc para tomar el último pago real
    const sorted = [...list].sort((a: any, b: any) => {
      const da = (a.fechaPago || '').slice(0, 10)
      const db = (b.fechaPago || '').slice(0, 10)
      return db.localeCompare(da)
    })
    const ultimo = sorted[0]
    const nextNumCuota = maxCuota >= 0 ? String(maxCuota + 1) : ''
    const nextVenc = ultimo?.fechaPago ? addOneMonth(ultimo.fechaPago) : ''
    return {
      vlrTotalProg: cuotaCero?.vlrTotalProg != null ? String(cuotaCero.vlrTotalProg) : '',
      valorCuota:   cuotaCero?.valorCuota   != null ? String(cuotaCero.valorCuota)   : '',
      numCuota:     nextNumCuota,
      fechaVencimiento: nextVenc,
    }
  }

  // Restore draft on open
  useEffect(() => {
    if (!isOpen) return
    draftRestored.current = false
    try {
      const raw = localStorage.getItem(draftKey)
      if (raw) {
        const draft = JSON.parse(raw)
        if (draft.savedAt && Date.now() - draft.savedAt < DRAFT_TTL_MS) {
          setShowDraftBanner(true)
          ;(window as any).__pagoDraft = draft
          return
        } else {
          localStorage.removeItem(draftKey)
        }
      }
    } catch {}
    // Set defaults from titular + auto-populate desde pagos existentes
    setForm({
      ...empty(),
      plataforma: titular.plataforma || '',
      ...computeAutoDefaults(),
    })
    draftRestored.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, draftKey])

  // Auto-save (debounced 500ms)
  useEffect(() => {
    if (!isOpen || !draftRestored.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ ...form, savedAt: Date.now() }))
      } catch {}
    }, 500)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [form, isOpen, draftKey])

  const restoreDraft = () => {
    const draft = (window as any).__pagoDraft as DraftState | undefined
    if (draft) {
      const { savedAt: _omit, ...data } = draft as any
      setForm({ ...empty(), ...data })
      delete (window as any).__pagoDraft
    }
    setShowDraftBanner(false)
    draftRestored.current = true
  }

  const discardDraft = () => {
    localStorage.removeItem(draftKey)
    delete (window as any).__pagoDraft
    setForm({ ...empty(), plataforma: titular.plataforma || '', ...computeAutoDefaults() })
    setShowDraftBanner(false)
    draftRestored.current = true
  }

  // Saldo computado en vivo
  const saldo = Math.max(0, toNum(form.valorCuota) - toNum(form.valorPagado) - toNum(form.descuento))

  // Upload de documentos (mismo flujo que UploadDocButton)
  const uploadFiles = async (files: File[]) => {
    if (!files.length) return
    for (const file of files) {
      setUploadingFiles(prev => [...prev, file.name])
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(`/api/contracts/${titular._id}/upload-url`, { method: 'POST', body: fd })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          // err.details suele traer la causa real (handler() guarda el mensaje original ahí)
          const msg = err.details || err.error || `Upload failed: ${res.status}`
          throw new Error(msg)
        }
        const { publicUrl } = await res.json()
        setForm(f => ({
          ...f,
          documentosAdjuntos: [
            ...f.documentosAdjuntos,
            { url: publicUrl, nombre: file.name, tipo: file.type, fechaSubida: new Date().toISOString() },
          ],
        }))
        toast.success(`${file.name} subido`)
      } catch (err: any) {
        toast.error(`Error subiendo ${file.name}: ${err?.message || ''}`)
      } finally {
        setUploadingFiles(prev => prev.filter(n => n !== file.name))
      }
    }
  }

  const openFileChooser = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = 'image/jpeg,image/jpg,image/png,image/webp,image/heic,application/pdf'
    input.style.display = 'none'
    document.body.appendChild(input)
    input.addEventListener('change', () => {
      uploadFiles(Array.from(input.files || []))
      document.body.removeChild(input)
    })
    input.click()
  }

  const removeDoc = (idx: number) => {
    setForm(f => ({ ...f, documentosAdjuntos: f.documentosAdjuntos.filter((_, i) => i !== idx) }))
  }

  const handleSubmit = async () => {
    if (!form.fechaPago) { toast.error('Fecha de pago es requerida'); return }
    if (toNum(form.valorPagado) <= 0) { toast.error('Valor pagado debe ser mayor a 0'); return }
    if (form.numCuota && Number(form.numCuota) < 0) { toast.error('Número de cuota no puede ser negativo'); return }

    setSubmitting(true)
    try {
      await api.post('/api/postgres/pagos-titulares', {
        idPeople: titular._id,
        numeroId: titular.numeroId || null,
        gestorRecaudo: titular.gestorRecaudo || null,
        plataforma: form.plataforma || titular.plataforma || null,
        pagoTercero: form.pagoTercero || null,
        idTercero: form.idTercero || null,
        fechaPago: form.fechaPago,
        fechaVencimiento: form.fechaVencimiento || null,
        plan: form.plan ? toNum(form.plan) : null,
        vlrTotalProg: form.vlrTotalProg ? toNum(form.vlrTotalProg) : null,
        numCuota: form.numCuota === '' ? null : Number(form.numCuota),
        valorCuota: form.valorCuota ? toNum(form.valorCuota) : null,
        valorPagado: form.valorPagado ? toNum(form.valorPagado) : null,
        descuento: form.descuento ? toNum(form.descuento) : 0,
        medioPago: form.medioPago || null,
        numeroReferencia: form.numeroReferencia || null,
        documentosAdjuntos: form.documentosAdjuntos,
      })
      toast.success('Pago registrado')
      localStorage.removeItem(draftKey)
      onCreated()
      onClose()
    } catch (err) {
      handleApiError(err, 'Error al registrar pago')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-xl">
          <div>
            <h3 className="text-lg font-bold text-gray-900">💵 Registrar Pago</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Titular: {titular.primerNombre} {titular.primerApellido} · ID {titular.numeroId || '—'}
            </p>
          </div>
          <button type="button" onClick={onClose} title="Cerrar" className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {showDraftBanner && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between">
              <p className="text-sm text-amber-800">
                Hay un borrador guardado de un pago anterior. ¿Quieres continuarlo?
              </p>
              <div className="flex gap-2">
                <button onClick={restoreDraft} type="button" className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 rounded hover:bg-amber-700">
                  Continuar
                </button>
                <button onClick={discardDraft} type="button" className="px-3 py-1.5 text-xs font-medium text-amber-800 bg-white border border-amber-300 rounded hover:bg-amber-50">
                  Descartar
                </button>
              </div>
            </div>
          )}

          {/* Read-only context */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div>
              <div className="text-gray-500">Gestor de Recaudo</div>
              <div className="font-medium text-gray-900">{gestorLabel || '⚠️ Sin asignar'}</div>
            </div>
            <div>
              <div className="text-gray-500">Plataforma</div>
              <div className="font-medium text-gray-900">{titular.plataforma || '—'}</div>
            </div>
            <div>
              <div className="text-gray-500">Número ID</div>
              <div className="font-medium text-gray-900">{titular.numeroId || '—'}</div>
            </div>
          </div>

          {/* Fechas */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="fechaPago" className="block text-sm font-medium text-gray-700">
                Fecha de Pago <span className="text-red-500">*</span>
              </label>
              <input
                id="fechaPago" type="date" value={form.fechaPago}
                readOnly tabIndex={-1}
                onChange={() => {}}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-100 text-gray-600 cursor-not-allowed"
              />
            </div>
            <div>
              <label htmlFor="fechaVencimiento" className="block text-sm font-medium text-gray-700">
                Fecha de Vencimiento
              </label>
              <input
                id="fechaVencimiento" type="date" value={form.fechaVencimiento}
                readOnly tabIndex={-1}
                onChange={() => {}}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-100 text-gray-600 cursor-not-allowed"
              />
            </div>
          </div>

          {/* Plan / Cuota */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="plan" className="block text-sm font-medium text-gray-700">Plan</label>
              <input
                id="plan" type="number" min={0} step="1" value={form.plan}
                onChange={e => setForm(f => ({ ...f, plan: e.target.value.replace(/[^0-9]/g, '') }))}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="0"
              />
            </div>
            <MoneyInput id="vlrTotalProg" label="Total del Programa" value={form.vlrTotalProg} onChange={v => setForm(f => ({ ...f, vlrTotalProg: v }))} readOnly />
            <div>
              <label htmlFor="numCuota" className="block text-sm font-medium text-gray-700"># Cuota</label>
              <input
                id="numCuota" type="number" min={0} value={form.numCuota}
                readOnly tabIndex={-1}
                onChange={() => {}}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-100 text-gray-600 cursor-not-allowed"
                placeholder="0"
              />
            </div>
          </div>

          {/* Valores */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <MoneyInput id="valorCuota" label="Valor Cuota" value={form.valorCuota} onChange={v => setForm(f => ({ ...f, valorCuota: v }))} readOnly />
            <MoneyInput id="valorPagado" label="Valor Pagado" value={form.valorPagado} onChange={v => setForm(f => ({ ...f, valorPagado: v }))} required />
            <MoneyInput id="descuento" label="Descuento" value={form.descuento} onChange={v => setForm(f => ({ ...f, descuento: v }))} />
            <div>
              <label className="block text-sm font-medium text-gray-700">Saldo (calculado)</label>
              <div className="mt-1 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-sm font-semibold text-amber-900">
                $ {new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(saldo)}
              </div>
            </div>
          </div>

          {/* Pago / Referencia */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="medioPago" className="block text-sm font-medium text-gray-700">Medio de Pago</label>
              <input
                id="medioPago" type="text" value={form.medioPago}
                onChange={e => setForm(f => ({ ...f, medioPago: e.target.value }))}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="Transferencia, Webpay, PSE, ..."
              />
            </div>
            <div>
              <label htmlFor="numeroReferencia" className="block text-sm font-medium text-gray-700"># Referencia</label>
              <input
                id="numeroReferencia" type="text" value={form.numeroReferencia}
                onChange={e => setForm(f => ({ ...f, numeroReferencia: e.target.value.replace(/[^A-Za-z0-9\-]/g, '') }))}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="Alfanumérico"
              />
            </div>
          </div>

          {/* Pago Tercero */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-xs text-blue-800 mb-3">
              Si el pago lo realizó <strong>otra persona</strong> en nombre del titular, completa estos campos (opcional).
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pagoTercero" className="block text-sm font-medium text-gray-700">Nombre Tercero</label>
                <input
                  id="pagoTercero" type="text" value={form.pagoTercero}
                  onChange={e => setForm(f => ({ ...f, pagoTercero: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label htmlFor="idTercero" className="block text-sm font-medium text-gray-700">ID Tercero</label>
                <input
                  id="idTercero" type="text" value={form.idTercero}
                  onChange={e => setForm(f => ({ ...f, idTercero: e.target.value.replace(/[^A-Za-z0-9]/g, '') }))}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="Alfanumérico"
                />
              </div>
            </div>
          </div>

          {/* Documentos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">Documentos Adjuntos</label>
              <button
                type="button"
                onClick={openFileChooser}
                disabled={uploadingFiles.length > 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                <ArrowUpTrayIcon className="h-3.5 w-3.5" />
                {uploadingFiles.length > 0 ? `Subiendo (${uploadingFiles.length})...` : 'Adjuntar'}
              </button>
            </div>
            {form.documentosAdjuntos.length === 0 ? (
              <p className="text-xs text-gray-400 italic">Sin documentos adjuntos</p>
            ) : (
              <ul className="space-y-1">
                {form.documentosAdjuntos.map((d, i) => (
                  <li key={i} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-xs">
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate flex-1 mr-2">
                      {d.nombre}
                    </a>
                    <button type="button" onClick={() => removeDoc(i)} className="text-red-500 hover:text-red-700" title="Quitar">
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-3 flex items-center justify-end gap-3 rounded-b-xl">
          <button
            type="button" onClick={onClose} disabled={submitting}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-white disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button" onClick={handleSubmit} disabled={submitting || uploadingFiles.length > 0}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50"
          >
            {submitting ? 'Guardando…' : 'Registrar Pago'}
          </button>
        </div>
      </div>
    </div>
  )
}
