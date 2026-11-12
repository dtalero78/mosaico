'use client'

import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { XMarkIcon, ArrowUpTrayIcon, TrashIcon } from '@heroicons/react/24/outline'
import { api, handleApiError } from '@/hooks/use-api'
import { PermissionGuard } from '@/components/permissions'
import { PersonPermission } from '@/types/permissions'
import { ACCEPT_DOCUMENTOS } from '@/lib/documentos-adjuntos'
import { getLocalToday } from '@/lib/fecha-local'
import { asignarPagos, simularPago } from '@/lib/cuotas-pagos'
import { resolveRealizadoPor, diasDesdeBase, fechaBaseContrato as calcFechaBase, VENTANA_COMERCIAL_DIAS } from '@/lib/cambio-contado'
import RecibosDobles, { type ReciboArchivo, sumaLeida, fmtPesos as fmtPesosRec } from '@/components/common/RecibosDobles'
import { usePermissions } from '@/hooks/usePermissions'
import { mediosPagoPara } from '@/lib/medios-pago'
import { medioDelCatalogo, avisoDestino, type ReciboExtraido } from '@/lib/recibo-inscripcion'

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
    /** Para atribuir el Cambio Contado: fecha de creación del contrato y respaldos. */
    _createdDate?: string | null
    inicioContrato?: string | null
    fechaContrato?: string | null
  }
  /** Display label of gestor recaudo to show in read-only field. */
  gestorLabel?: string | null
  /** Lista de pagos existentes del titular — usado para auto-populate:
   *  - `vlrTotalProg`/`valorCuota` ← cuota #0
   *  - `numCuota` ← max(numCuota) + 1
   *  - `fechaVencimiento` (Fecha Primer Pago) ← cuota#0.fechaVencimiento o
   *    cuota#0.fechaPago (fecha base contractual) */
  existingPagos?: any[]
  /** Saldo a la Fecha actual (FINANCIEROS.saldo, dinámico — mantenido por
   *  syncFinancieroSaldo). El wizard lo usa para mostrar el campo y computar
   *  "Saldo después de pago" en vivo. */
  saldoActual?: number
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
  /** Fecha de Reporte — cuándo se registró el pago en el sistema (default hoy local).
   *  Separada de fechaPago (cuándo realmente pagó el titular). Se persiste en
   *  PAGOS_TITULARES.fechaReporte (columna nueva mayo 2026). */
  fechaReporte: string
  /** Fecha Primer Pago — fecha base contractual (FINANCIEROS.fechaPago).
   *  Read-only en el wizard; viene auto-poblada de cuota#0. La columna en BD
   *  sigue llamándose `fechaVencimiento` por compatibilidad legacy. */
  fechaVencimiento: string
  plan: string
  vlrTotalProg: string
  numCuota: string
  valorCuota: string
  valorPagado: string
  descuento: string
  medioPago: string
  numeroReferencia: string
  banco: string
  pagoTercero: string
  idTercero: string
  plataforma: string
  documentosAdjuntos: DocAdjunto[]
  /**
   * Cambio de tipoCartera disparado AL registrar el pago (opcional).
   * '' = sin cambio · 'ultimopago' o 'penalidad' = al guardar el pago se
   * dispara también POST /cambio-cartera con motivo auto-generado.
   * Mutuamente exclusivo (sólo uno marcado a la vez).
   */
  cambioCartera: '' | 'ultimopago' | 'penalidad'
  /**
   * "El pago tiene dos recibos" — el pago se respalda con DOS comprobantes
   * (recibo 1 y 2) y el valor se digita a mano: la IA no lo llena.
   */
  dosRecibos: boolean
  recibos: (ReciboArchivo | null)[]
  /**
   * Cambio Contado — marca que este pago corresponde al cambio de plan a contado.
   * Al guardarlo, el servidor registra en `realizadopor` quién lo gestionó
   * (Comercial dentro de los 30 días de creado el contrato, Recaudos después).
   */
  cambioContado: boolean
  /** Nota del pago. Obligatoria si se marca "Cambio Contado" (el servidor la exige igual). */
  nota: string
}

const DRAFT_TTL_MS = 72 * 60 * 60 * 1000 // 72 horas

const empty = (): DraftState => ({
  fechaPago: getLocalToday(),
  fechaReporte: getLocalToday(),
  fechaVencimiento: '',
  plan: '',
  vlrTotalProg: '',
  numCuota: '',
  valorCuota: '',
  valorPagado: '',
  descuento: '',
  medioPago: '',
  numeroReferencia: '',
  banco: '',
  pagoTercero: '',
  idTercero: '',
  plataforma: '',
  documentosAdjuntos: [],
  cambioCartera: '',
  dosRecibos: false,
  recibos: [null, null],
  cambioContado: false,
  nota: '',
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

/** YYYY-MM-DD + N meses → YYYY-MM-DD. Preserva el día; en overflow va al último día del mes objetivo. */
function addNMonths(dateStr: string | null | undefined, n: number): string {
  if (!dateStr || !Number.isFinite(n)) return ''
  const ymd = String(dateStr).slice(0, 10)
  const parts = ymd.split('-').map(Number)
  if (parts.length !== 3 || parts.some(x => !Number.isFinite(x))) return ''
  const [y, m, d] = parts // m es 1-indexed
  let newMonth = m + n
  let newYear = y
  while (newMonth > 12) { newMonth -= 12; newYear++ }
  while (newMonth < 1)  { newMonth += 12; newYear-- }
  const target = new Date(Date.UTC(newYear, newMonth - 1, d))
  if (target.getUTCMonth() !== newMonth - 1) {
    // Día overflowed (ej: día 31 en Feb) → último día del mes objetivo
    return new Date(Date.UTC(newYear, newMonth, 0)).toISOString().slice(0, 10)
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
  isOpen, onClose, titular, gestorLabel, existingPagos, saldoActual, onCreated,
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
  //  - cuota#0.fechaVencimiento + N meses → próxima fechaVencimiento
  //    (donde N = número de la próxima cuota; el día se hereda de paso 6
  //    de /dashboard/comercial/crear-contrato y se conserva mes a mes)
  //    Fallback: addOneMonth(último pago.fechaPago)
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
    // Cuota sugerida = la primera NO completa (los abonos suman); si no hay plan
    // para saberlo, la siguiente a la mayor registrada.
    const planAuto = {
      inscripcion: toNum(String(cuotaCero?.inscripcion ?? cuotaCero?.valorPagado ?? 0)),
      valorCuota: toNum(String(cuotaCero?.valorCuota ?? 0)),
      numeroCuotas: Number(cuotaCero?.cuotasTotal) || 0,
    }
    const primeraIncompleta = planAuto.valorCuota > 0 && planAuto.numeroCuotas > 0
      ? asignarPagos({ ...planAuto, pagos: list }).primeraIncompleta
      : null
    const sugerida = primeraIncompleta != null && primeraIncompleta >= 1 ? primeraIncompleta : (maxCuota >= 0 ? maxCuota + 1 : 1)
    const nextNumCuota = String(sugerida)
    const nextNumCuotaNum = sugerida
    // Preferir cuota#0.fechaVencimiento (paso 6 de crear-contrato) como base,
    // y avanzar N meses para la cuota actual. Cae a fechaPago si no existe.
    const billingRef = cuotaCero?.fechaVencimiento || cuotaCero?.fechaPago
    const nextVenc = billingRef
      ? addNMonths(String(billingRef).slice(0, 10), nextNumCuotaNum)
      : (ultimo?.fechaPago ? addOneMonth(String(ultimo.fechaPago).slice(0, 10)) : '')
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

  // ── Derivados read-only desde cuota#0 + saldoActual (prop) ───────────
  // Snapshot del contrato para mostrar en el wizard.
  const cuotaCero: any = Array.isArray(existingPagos)
    ? existingPagos.find((p: any) => Number(p.numCuota) === 0)
    : null
  const totalPlanNum    = toNum(String(cuotaCero?.vlrTotalProg ?? form.vlrTotalProg))
  const inscripcionNum  = toNum(String(cuotaCero?.inscripcion ?? cuotaCero?.valorPagado ?? 0))
  const saldoFirma      = Math.max(0, totalPlanNum - inscripcionNum)
  const cuotasTotalNum  = Number(cuotaCero?.cuotasTotal) || 0
  const saldoFechaNum   = Math.max(0, Number(saldoActual ?? 0))

  // ── Abonos (src/lib/cuotas-pagos.ts): cada pago EMPIEZA en su cuota y desborda
  // hacia adelante; dos pagos pueden llevar la misma cuota. ──────────────────
  const fmtPesos = (n: number) => '$ ' + new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Math.round(n || 0))
  const pagosReales: any[] = Array.isArray(existingPagos) ? existingPagos : []
  const planWizard = {
    inscripcion: inscripcionNum,
    valorCuota: toNum(String(cuotaCero?.valorCuota ?? form.valorCuota)),
    numeroCuotas: cuotasTotalNum,
  }
  const asig = planWizard.valorCuota > 0 && planWizard.numeroCuotas > 0
    ? asignarPagos({ ...planWizard, pagos: pagosReales })
    : null
  const numCuotaNum = form.numCuota !== '' ? Number(form.numCuota) : NaN
  const cuotaElegida = asig && Number.isFinite(numCuotaNum) ? asig.cuotas[numCuotaNum] : undefined
  // N° de pago = consecutivo por titular (lo asigna el servidor al guardar).
  const nPago = pagosReales.reduce((m: number, x: any) => Math.max(m, Number(x.numPago) || 0), 0) + 1

  // ── Cálculos en vivo de esta captura ──────────────────────────────────
  // El descuento es una REBAJA SOBRE LA CUOTA: se le perdona parte de lo que
  // debía pagar, pero la cuota queda saldada igual. Por eso el descuento SUMA
  // a lo que se aplica contra el saldo — si la cuota es 115.000 y se le
  // descuentan 25.000, el titular paga 90.000 y el saldo baja los 115.000
  // completos. Restarlo (como se hacía antes) mostraba 65.000 e inducía a
  // capturar el pago por el valor entero de la cuota, aplicando de más.
  // El endpoint server-side recomputa `saldo` con esta misma fórmula antes
  // de insertar (no confía en el cliente).
  const valorAplicar = Math.max(0, toNum(form.valorPagado) + toNum(form.descuento))
  const saldoDespues = Math.max(0, saldoFechaNum - valorAplicar)

  // Aviso preventivo: con la regla de negocio, pagado + descuento debe dar el
  // valor de la cuota. Si excede, casi siempre es que se capturó el pago por la
  // cuota entera y ADEMÁS se puso el descuento (se aplicaría de más contra el
  // saldo). No se bloquea — un abono adelantado legítimo también excede.
  const cuotaNum = toNum(form.valorCuota)
  const excedeCuota = cuotaNum > 0 && valorAplicar > cuotaNum
  const simulacion = asig && Number.isFinite(numCuotaNum) && numCuotaNum >= 1 && valorAplicar > 0
    ? simularPago(asig, numCuotaNum, toNum(form.valorPagado), toNum(form.descuento))
    : null

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
    input.accept = ACCEPT_DOCUMENTOS
    input.style.display = 'none'
    document.body.appendChild(input)
    input.addEventListener('change', () => {
      uploadFiles(Array.from(input.files || []))
      document.body.removeChild(input)
    })
    input.click()
  }

  // Leer comprobante: sube el archivo, lo adjunta al pago y precarga el formulario
  // con lo que la IA lee. Nunca pisa lo que ya se escribió, y el valor sólo se
  // llena si está vacío: quien registra revisa y confirma.
  const { hasPermission } = usePermissions()
  const puedeLeerRecibo = hasPermission(PersonPermission.LEER_RECIBO)

  // Dos recibos: el valor NO lo llena la IA. Del recibo 1 se precargan fecha,
  // medio, banco y referencia (sin pisar lo ya escrito); del 2 sólo se muestra el monto leído.
  const toggleDosRecibos = () => setForm(f => f.dosRecibos
    ? { ...f, dosRecibos: false, recibos: [null, null] }
    : { ...f, dosRecibos: true, valorPagado: '' })
  const onReciboLeido = (indice: number, e: any) => {
    if (indice !== 0) return
    setForm(f => ({
      ...f,
      fechaPago: (typeof e.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.fecha)) ? e.fecha : f.fechaPago,
      medioPago: f.medioPago || e.medioPago || '',
      banco: f.banco || e.banco || '',
      numeroReferencia: f.numeroReferencia || String(e.referencia || '').replace(/[^A-Za-z0-9\-]/g, ''),
    }))
  }
  const sumaRecibos = sumaLeida(form.recibos)
  const difiereDeSuma = form.dosRecibos && sumaRecibos != null && toNum(form.valorPagado) > 0
    && Math.round(toNum(form.valorPagado)) !== Math.round(sumaRecibos)

  // Cambio Contado: vista previa de a quién se atribuirá (el servidor es la autoridad).
  const fechaBaseCC = calcFechaBase(titular as any)
  const diasPreview = diasDesdeBase(fechaBaseCC, form.fechaPago)
  const realizadoPorPreview = resolveRealizadoPor(fechaBaseCC, form.fechaPago)

  const [leyendo, setLeyendo] = useState(false)
  // Lo leído del comprobante espera la confirmación de quien registra el pago.
  const [lectura, setLectura] = useState<ReciboExtraido | null>(null)
  const [duplicados, setDuplicados] = useState<any[]>([])
  const leerComprobante = async (file: File) => {
    setLeyendo(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const up = await fetch(`/api/contracts/${titular._id}/upload-url`, { method: 'POST', body: fd })
      if (!up.ok) {
        const e = await up.json().catch(() => ({} as any))
        throw new Error(e.details || e.error || `Error ${up.status}`)
      }
      const { publicUrl } = await up.json()
      setForm(f => ({
        ...f,
        documentosAdjuntos: [...f.documentosAdjuntos,
          { url: publicUrl, nombre: file.name, tipo: file.type, fechaSubida: new Date().toISOString() }],
      }))
      const d = await api.post<{ extraido: any; duplicados?: any[] }>('/api/postgres/pagos-titulares/leer-comprobante', { url: publicUrl, idPeople: titular._id })
      setDuplicados(d.duplicados || [])
      setLectura(d.extraido || {})
      toast.success('Comprobante leído — confirma los datos')
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo leer el comprobante')
    } finally {
      setLeyendo(false)
    }
  }
  const pickComprobante = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/jpg,image/png,image/webp,application/pdf'
    input.style.display = 'none'
    document.body.appendChild(input)
    input.addEventListener('change', () => {
      const fl = input.files?.[0]
      if (fl) leerComprobante(fl)
      document.body.removeChild(input)
    })
    input.click()
  }

  const removeDoc = (idx: number) => {
    setForm(f => ({ ...f, documentosAdjuntos: f.documentosAdjuntos.filter((_, i) => i !== idx) }))
  }

  const handleSubmit = async () => {
    if (!form.fechaPago) { toast.error('Fecha de pago es requerida'); return }
    if (form.dosRecibos && (!form.recibos[0] || !form.recibos[1])) {
      toast.error('Marcaste "El pago tiene dos recibos": adjunta el recibo 1 y el recibo 2'); return
    }
    if (form.cambioContado && !form.nota.trim()) {
      toast.error('La nota es obligatoria cuando el pago es Cambio Contado'); return
    }
    if (toNum(form.valorPagado) <= 0) {
      toast.error(form.dosRecibos ? 'Digita el valor total del pago (suma de los dos recibos)' : 'Valor pagado debe ser mayor a 0'); return
    }
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
        fechaReporte: form.fechaReporte || null,
        fechaVencimiento: form.fechaVencimiento || null,
        plan: form.plan || null,
        vlrTotalProg: form.vlrTotalProg ? toNum(form.vlrTotalProg) : null,
        numCuota: form.numCuota === '' ? null : Number(form.numCuota),
        valorCuota: form.valorCuota ? toNum(form.valorCuota) : null,
        valorPagado: form.valorPagado ? toNum(form.valorPagado) : null,
        descuento: form.descuento ? toNum(form.descuento) : 0,
        medioPago: form.medioPago || null,
        numeroReferencia: form.numeroReferencia || null,
        banco: form.banco.trim() || null,
        // Con dos recibos, los comprobantes van como adjuntos marcados recibo 1 y 2.
        documentosAdjuntos: [
          ...form.documentosAdjuntos,
          ...(form.dosRecibos
            ? form.recibos.flatMap((r, i) => r ? [{
                url: r.url, nombre: `Recibo ${i + 1} · ${r.nombre}`, tipo: r.tipo,
                fechaSubida: r.fechaSubida, recibo: i + 1, montoLeido: r.montoLeido ?? null,
              }] : [])
            : []),
        ],
        dosRecibos: form.dosRecibos,
        // Cambio Contado: el servidor deriva `realizadopor` de la fecha del pago
        // contra la creación del contrato — acá sólo se envía la marca y la nota.
        cambioContado: form.cambioContado,
        nota: form.nota.trim() || null,
      })

      // Cambio de tipoCartera disparado desde la casilla en el wizard.
      // Best-effort: si falla, el pago YA quedó registrado — sólo se muestra
      // un toast.error indicando que el cambio de cartera no se aplicó.
      if (form.cambioCartera) {
        try {
          const motivoAuto = `Marcado automáticamente al registrar pago${
            form.numCuota !== '' ? ` cuota #${form.numCuota}` : ''
          }${form.valorPagado ? ` ($${form.valorPagado})` : ''}`
          await api.post(`/api/postgres/people/${titular._id}/cambio-cartera`, {
            nuevoTipo: form.cambioCartera,
            motivo: motivoAuto,
          })
        } catch (err) {
          handleApiError(err, 'Pago registrado, pero falló el cambio de cartera')
        }
      }

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

          {/* Dos recibos — el pago viene en DOS comprobantes: se suben ambos y el
              valor se digita a mano (la IA no lo llena). */}
          <div className={`rounded-lg border p-3 space-y-3 ${form.dosRecibos ? 'border-emerald-300 bg-emerald-50/40' : 'border-gray-200 bg-gray-50'}`}>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none">
              <input type="checkbox" checked={form.dosRecibos} onChange={toggleDosRecibos}
                className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
              El pago tiene dos recibos
            </label>
            {form.dosRecibos && (
              <>
                <RecibosDobles
                  carpetaId={titular._id}
                  recibos={form.recibos}
                  onChange={recibos => setForm(f => ({ ...f, recibos }))}
                  leerConIA={puedeLeerRecibo}
                  onLeido={onReciboLeido}
                />
                <p className="text-xs font-medium text-emerald-800">
                  Digita en <strong>Valor a Pagar</strong> el monto total del pago (los dos recibos juntos).
                </p>
              </>
            )}
          </div>

          {/* Fila 1 — Fechas: pago (edit), reporte (edit, default hoy),
              primer pago (read-only, del contrato) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="fechaPago" className="block text-sm font-medium text-gray-700">
                Fecha de Pago <span className="text-red-500">*</span>
              </label>
              <input
                id="fechaPago" type="date" value={form.fechaPago}
                onChange={e => setForm(f => ({ ...f, fechaPago: e.target.value }))}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label htmlFor="fechaReporte" className="block text-sm font-medium text-gray-700">
                Fecha de Reporte
              </label>
              <input
                id="fechaReporte" type="date" value={form.fechaReporte}
                onChange={e => setForm(f => ({ ...f, fechaReporte: e.target.value }))}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label htmlFor="fechaVencimiento" className="block text-sm font-medium text-gray-700">
                Fecha Primer Pago
              </label>
              <input
                id="fechaVencimiento" type="date" value={form.fechaVencimiento}
                readOnly tabIndex={-1}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-100 text-gray-600 cursor-not-allowed"
              />
            </div>
          </div>

          {/* Fila 2 — Snapshot del contrato (todos read-only) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MoneyInput id="vlrTotalProg" label="Total del Programa"
              value={form.vlrTotalProg} onChange={() => {}} readOnly />
            <div>
              <label htmlFor="cuotasTotal" className="block text-sm font-medium text-gray-700">
                Cuotas Totales
              </label>
              <input
                id="cuotasTotal" type="text" readOnly tabIndex={-1}
                value={cuotasTotalNum || ''}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-100 text-gray-600 cursor-not-allowed"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Saldo a la Firma</label>
              <div className="mt-1 px-3 py-2 bg-gray-100 border border-gray-300 rounded-md text-sm text-gray-700">
                $ {new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(saldoFirma)}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="numCuota" className="block text-sm font-medium text-gray-700"># Cuota</label>
                <span className="text-xs text-gray-500">Pago N° {nPago}</span>
              </div>
              <input
                id="numCuota" type="number" min={0}
                value={form.numCuota}
                onChange={e => setForm(f => ({ ...f, numCuota: e.target.value.replace(/[^0-9]/g, '') }))}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-center font-semibold"
                placeholder="0"
              />
              {cuotaElegida && numCuotaNum >= 1 && (
                <p className={'mt-1 text-xs font-medium ' + (cuotaElegida.completa ? 'text-red-700' : cuotaElegida.cubierto > 0.5 ? 'text-amber-700' : 'text-gray-500')}>
                  {cuotaElegida.completa
                    ? 'Esta cuota ya está completa'
                    : cuotaElegida.cubierto > 0.5
                      ? `Abonado ${fmtPesos(cuotaElegida.cubierto)} · faltan ${fmtPesos(cuotaElegida.falta)}`
                      : `Valor ${fmtPesos(cuotaElegida.valor)}`}
                </p>
              )}
            </div>
          </div>

          {/* Fila 3 — Plan + Saldo a la Fecha + Valor Cuota */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="plan" className="block text-sm font-medium text-gray-700">Plan</label>
              <select
                id="plan" value={form.plan}
                onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">Seleccione</option>
                <option value="Contado">Contado</option>
                <option value="Credito">Credito</option>
                <option value="Colaborador">Colaborador</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Saldo a la Fecha</label>
              <div className="mt-1 px-3 py-2 bg-gray-100 border border-gray-300 rounded-md text-sm font-medium text-gray-800">
                $ {new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(saldoFechaNum)}
              </div>
            </div>
            <MoneyInput id="valorCuota" label="Valor Cuota"
              value={form.valorCuota} onChange={() => {}} readOnly />
          </div>

          {/* Fila 4 — Cálculo del pago: edit + computed */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MoneyInput id="valorPagado" label="Valor a Pagar"
              value={form.valorPagado}
              onChange={v => setForm(f => ({ ...f, valorPagado: v }))} required />
            <MoneyInput id="descuento" label="Descuento"
              value={form.descuento}
              onChange={v => setForm(f => ({ ...f, descuento: v }))} />
            <div>
              <label className="block text-sm font-medium text-gray-700">Valor a Aplicar</label>
              <div className="mt-1 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-sm font-semibold text-amber-900">
                $ {new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(valorAplicar)}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Saldo después de pago</label>
              <div className="mt-1 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-md text-sm font-semibold text-emerald-900">
                $ {new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(saldoDespues)}
              </div>
            </div>
          </div>

          {excedeCuota && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <strong>Revisa el valor a pagar.</strong> Con el descuento se aplicarían{' '}
              $ {new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(valorAplicar)}{' '}
              contra el saldo, y la cuota es de $ {new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(cuotaNum)}.{' '}
              El descuento es una rebaja sobre la cuota: si se le descuentan{' '}
              $ {new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(toNum(form.descuento))},{' '}
              el titular paga{' '}
              $ {new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Math.max(0, cuotaNum - toNum(form.descuento)))}{' '}
              y la cuota queda saldada igual.
            </div>
          )}

          {difiereDeSuma && sumaRecibos != null && (
            <p className="-mt-2 text-sm font-medium text-amber-700">
              El valor digitado ({fmtPesosRec(toNum(form.valorPagado))}) no coincide con la suma leída de los dos recibos ({fmtPesosRec(sumaRecibos)}). Revísalo antes de registrar.
            </p>
          )}

          {/* Cómo queda el pago (regla de src/lib/cuotas-pagos.ts): completa lo que falta
              de la cuota y el excedente pasa a las siguientes; el descuento completa
              la cuota igual que el efectivo. */}
          {simulacion && simulacion.reparto.length > 0 && (
            <div className="rounded-lg border border-primary-200 bg-primary-50 p-3 text-sm">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <p className="font-bold text-primary-800">Así queda el pago N° {nPago}</p>
                {simulacion.esAbono && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">Abono</span>
                )}
              </div>
              <ul className="space-y-1">
                {simulacion.reparto.map(r => (
                  <li key={r.n} className="flex justify-between gap-3 text-primary-900">
                    <span>
                      {r.completa
                        ? (asig?.cuotas[r.n]?.cubierto ?? 0) > 0.5 ? `Completa cuota ${r.n}` : `Paga cuota ${r.n}`
                        : `Abono cuota ${r.n}`}
                      {!r.completa && <span className="text-amber-700"> (faltan {fmtPesos(r.falta)})</span>}
                    </span>
                    <span className="font-semibold tabular-nums">{fmtPesos(r.aplica)}</span>
                  </li>
                ))}
              </ul>
              {simulacion.sobrante > 0.5 && (
                <p className="mt-1.5 font-bold text-red-700">
                  El pago supera en {fmtPesos(simulacion.sobrante)} lo que falta del contrato.
                </p>
              )}
            </div>
          )}

          {/* Fila 5 — Medio de Pago / Banco / Referencia */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              <label htmlFor="banco" className="block text-sm font-medium text-gray-700">Banco</label>
              <input
                id="banco" type="text" value={form.banco} maxLength={80}
                onChange={e => setForm(f => ({ ...f, banco: e.target.value }))}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="Banco desde el que se pagó"
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

          {/* Cambio de Estado Cartera — opcional, mutuamente exclusivo.
              Al guardar el pago se dispara también POST /cambio-cartera con
              motivo auto-generado. Gateado por CAMBIO_ESTADO_CARTERA — sin
              ese permiso el bloque no aparece. */}
          <PermissionGuard permission={PersonPermission.CAMBIO_ESTADO_CARTERA}>
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
              <p className="text-xs text-orange-900 mb-3">
                🔄 Marca <strong>una</strong> opción para cambiar también el estado de cartera del titular al registrar este pago (opcional, mutuamente excluyente).
              </p>
              <div className="flex items-center gap-6">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.cambioCartera === 'ultimopago'}
                    onChange={e => setForm(f => ({
                      ...f,
                      cambioCartera: e.target.checked ? 'ultimopago' : '',
                    }))}
                    className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-sm font-medium text-purple-800">Último Pago</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.cambioCartera === 'penalidad'}
                    onChange={e => setForm(f => ({
                      ...f,
                      cambioCartera: e.target.checked ? 'penalidad' : '',
                    }))}
                    className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                  />
                  <span className="text-sm font-medium text-orange-800">Penalidad</span>
                </label>
              </div>
            </div>
          </PermissionGuard>

          {/* Cambio Contado — dato del pago, NO un estado de cartera: por eso va fuera
              del PermissionGuard de arriba. Al marcarlo, el servidor registra en
              `realizadopor` si el cambio lo gestionó Comercial (dentro de los 30 días
              de creado el contrato) o Recaudos (después). */}
          <div className="bg-teal-50 border border-teal-200 rounded-lg p-3">
            <label className="inline-flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.cambioContado}
                onChange={e => setForm(f => ({ ...f, cambioContado: e.target.checked }))}
                className="mt-0.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
              <span>
                <span className="text-base font-bold text-teal-900">Cambio Contado</span>
                <span className="block text-sm text-teal-800">
                  Marca que este pago corresponde al cambio del plan a contado.
                  Se registra automáticamente quién lo gestionó.
                </span>
              </span>
            </label>

            {form.cambioContado && (
              <div className="mt-3 pt-3 border-t border-teal-200 text-sm text-teal-900 space-y-3">
                <div>
                  {realizadoPorPreview ? (
                    <>
                      Quedará registrado como{' '}
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md text-base font-bold bg-teal-600 text-white align-middle">
                        {realizadoPorPreview}
                      </span>
                      {diasPreview !== null && (
                        <span className="block mt-1 text-teal-700">
                          {diasPreview < 0
                            ? ' — el pago es anterior a la creación del contrato'
                            : ' — el pago es del día ' + diasPreview + ' desde la creación del contrato'}
                          {' '}(hasta {VENTANA_COMERCIAL_DIAS} días es Comercial; después, Recaudos).
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-amber-800">
                      El contrato no tiene fecha de creación registrada, así que el campo
                      <em> Realizado por</em> quedará vacío. El pago se guarda igual.
                    </span>
                  )}
                </div>
                <label className="block">
                  <span className="text-base font-bold text-rose-900">Nota <span className="text-rose-600">*</span></span>
                  <span className="block text-sm text-rose-800 mt-0.5 mb-1">Obligatoria: explica el motivo del cambio del plan a contado.</span>
                  <textarea
                    value={form.nota}
                    onChange={e => setForm(f => ({ ...f, nota: e.target.value }))}
                    rows={3}
                    maxLength={500}
                    className="w-full px-3 py-2 border border-rose-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                    placeholder="Ej: el titular decidió pagar el saldo de contado con descuento autorizado"
                  />
                </label>
              </div>
            )}
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
              <div className="flex items-center gap-2">
              <PermissionGuard permission={PersonPermission.LEER_RECIBO}>
                <button
                  type="button"
                  onClick={pickComprobante}
                  disabled={leyendo || uploadingFiles.length > 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-50 border border-indigo-300 text-indigo-700 rounded-md hover:bg-indigo-100 disabled:opacity-50"
                  title="Sube el comprobante y precarga fecha, valor, medio y referencia"
                >
                  {leyendo ? 'Leyendo…' : '✨ Leer comprobante'}
                </button>
              </PermissionGuard>
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
      {lectura && (
        <ConfirmarLectura
          e={lectura} plataforma={titular.plataforma} duplicados={duplicados}
          onCancel={() => { setLectura(null); toast('Lectura descartada: el comprobante quedó adjunto, digita los datos'); }}
          onConfirm={v => {
            setForm(f => ({
              ...f,
              fechaPago: v.fecha,
              valorPagado: String(Math.round(v.monto)),
              medioPago: v.medio,
              numeroReferencia: v.referencia,
              banco: v.banco,
            }))
            setLectura(null)
          }}
        />
      )}
    </div>
  )
}

const TIPO_DOC_TXT: Record<string, string> = {
  APP_TRANSFERENCIA: 'Pantalla de transferencia de una app',
  DEPOSITO_CAJA: 'Boleta de depósito en caja',
  PAPELETA_MANUSCRITA: 'Papeleta de depósito llenada a mano',
  PASARELA: 'Comprobante de pasarela de pago',
  OTRO: 'Otro tipo de comprobante',
}

/**
 * Confirmación de lo que la IA leyó del comprobante. Nada se carga al pago hasta que
 * quien lo registra confirma: si se detectó una app (Mach...) se le pregunta; lo que
 * no se pudo leer (o se escribió a mano) se resalta y lo digita la persona.
 */
function ConfirmarLectura({ e, plataforma, duplicados, onConfirm, onCancel }: {
  e: ReciboExtraido
  plataforma?: string
  duplicados: any[]
  onConfirm: (v: { fecha: string; monto: number; medio: string; referencia: string; banco: string }) => void
  onCancel: () => void
}) {
  const medios = mediosPagoPara(plataforma)
  const medioInicial = medioDelCatalogo(e.medioPago, plataforma) || ''
  const ileg = new Set<string>(e.ilegibles || [])
  const [appOk, setAppOk] = useState<boolean | null>(e.app ? null : true)
  const [fecha, setFecha] = useState(e.fecha || '')
  const [monto, setMonto] = useState(e.monto != null ? String(Math.round(e.monto)) : '')
  const [medio, setMedio] = useState(medioInicial)
  const [referencia, setReferencia] = useState(String(e.referencia || '').replace(/[^A-Za-z0-9\-]/g, ''))
  const [banco, setBanco] = useState(e.banco || '')

  const montoNum = Number(String(monto).replace(/[^\d]/g, '')) || 0
  const faltaFecha = !/^\d{4}-\d{2}-\d{2}$/.test(fecha)
  const faltaMonto = !(montoNum > 0)
  const faltaMedio = !medio
  const bloqueado = appOk === null || faltaFecha || faltaMonto || faltaMedio
  // Un campo se resalta si la IA lo marcó ilegible, no lo encontró, o el documento es manuscrito.
  const dudoso = (k: string, vacio: boolean) => ileg.has(k) || vacio || (e.manuscrito && (k === 'monto' || k === 'fecha'))
  const cls = (k: string, vacio: boolean) =>
    `mt-1 w-full rounded-md border px-3 py-2 text-sm ${dudoso(k, vacio) ? 'border-amber-400 bg-amber-50' : 'border-gray-300'}`
  const nota = (k: string, vacio: boolean) => dudoso(k, vacio) && (
    <p className="mt-0.5 text-[11px] text-amber-700">
      {ileg.has(k) ? 'No se pudo leer con certeza: digítalo.' : vacio ? 'No apareció en el comprobante: digítalo.' : 'Escrito a mano: verifícalo.'}
    </p>
  )

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h4 className="text-base font-bold text-gray-900">Confirma lo leído del comprobante</h4>
        <p className="mt-1 text-xs text-gray-500">
          {e.tipoDocumento ? TIPO_DOC_TXT[e.tipoDocumento] : 'Comprobante'}
          {e.confianza != null ? ` · confianza ${Math.round(e.confianza * 100)}%` : ''}
        </p>

        {avisoDestino(e, plataforma) && (
          <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800">⚠ {avisoDestino(e, plataforma)}</div>
        )}
        {duplicados.length > 0 && (
          <div className="mt-3 rounded-md border border-orange-300 bg-orange-50 p-2 text-xs text-orange-900">
            <p className="font-semibold">Posible pago duplicado: este contrato ya tiene un pago con la misma referencia o con el mismo valor y fecha. Es solo un aviso: puedes continuar.</p>
            <ul className="mt-1 list-disc pl-4">
              {duplicados.map((d: any) => (
                <li key={d._id}>{d.titular} · contrato {d.contrato} · ${Number(d.valorPagado).toLocaleString('es-CL')} · {String(d.fechaPago || '').slice(0, 10)}{d.numeroReferencia ? ' · ref ' + d.numeroReferencia : ''}{d.validado ? ' · validado' : ''}</li>
              ))}
            </ul>
          </div>
        )}
        {e.manuscrito && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            ✋ Este documento tiene datos escritos a mano: compara el monto y la fecha con el papel antes de confirmar.
          </div>
        )}

        {e.app && (
          <div className="mt-3 rounded-md border border-indigo-200 bg-indigo-50 p-3">
            <p className="text-sm font-medium text-indigo-900">¿Es un pago con {e.app}?</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => { setAppOk(true); if (!banco) setBanco(e.app || '') }}
                className={`rounded-md border px-3 py-1 text-sm ${appOk === true ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300 bg-white text-gray-700'}`}>
                Sí, es {e.app}
              </button>
              <button type="button" onClick={() => { setAppOk(false); if (banco === e.app) setBanco('') }}
                className={`rounded-md border px-3 py-1 text-sm ${appOk === false ? 'border-red-500 bg-red-500 text-white' : 'border-gray-300 bg-white text-gray-700'}`}>
                No
              </button>
            </div>
            {appOk === false && <p className="mt-1 text-[11px] text-indigo-800">Digita abajo el banco o app desde la que se pagó.</p>}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700">Fecha del pago *</label>
            <input type="date" value={fecha} onChange={x => setFecha(x.target.value)} className={cls('fecha', faltaFecha)} />
            {nota('fecha', faltaFecha)}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">Valor pagado *</label>
            <input type="text" inputMode="numeric" value={monto ? new Intl.NumberFormat('es-CL').format(montoNum) : ''}
              onChange={x => setMonto(x.target.value.replace(/[^\d]/g, ''))} className={cls('monto', faltaMonto)} />
            {nota('monto', faltaMonto)}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">Medio de pago *</label>
            <select value={medio} onChange={x => setMedio(x.target.value)} className={cls('medioPago', faltaMedio)}>
              <option value="">Selecciona…</option>
              {medios.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {nota('medioPago', faltaMedio)}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">Banco / app de origen</label>
            <input type="text" value={banco} onChange={x => setBanco(x.target.value)} className={cls('banco', false)} />
            {ileg.has('banco') && nota('banco', false)}
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-700"># Referencia</label>
            <input type="text" value={referencia} onChange={x => setReferencia(x.target.value.replace(/[^A-Za-z0-9\-]/g, ''))} className={cls('referencia', false)} />
            {ileg.has('referencia')
              ? nota('referencia', false)
              : !referencia && <p className="mt-0.5 text-[11px] text-gray-500">El comprobante no trae número de operación; déjalo vacío si no lo tienes.</p>}
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            Descartar lectura
          </button>
          <button type="button" disabled={bloqueado}
            onClick={() => onConfirm({ fecha, monto: montoNum, medio, referencia, banco })}
            className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50">
            Confirmar y cargar
          </button>
        </div>
        {bloqueado && <p className="mt-1 text-right text-[11px] text-gray-500">Responde la pregunta de la app y completa fecha, valor y medio.</p>}
      </div>
    </div>
  )
}
