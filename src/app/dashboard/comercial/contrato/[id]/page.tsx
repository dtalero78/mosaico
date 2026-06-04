'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { ComercialPermission } from '@/types/permissions'
import { api, handleApiError } from '@/hooks/use-api'
import toast from 'react-hot-toast'
import {
  PencilIcon,
  CheckIcon,
  XMarkIcon,
  ArrowLeftIcon,
  UserIcon,
  UsersIcon,
  BanknotesIcon,
  DocumentTextIcon,
  PhoneIcon,
  EyeIcon,
  IdentificationIcon,
  CalendarIcon,
  ShieldCheckIcon,
  ArrowUpTrayIcon,
  TrashIcon,
  PaperClipIcon,
} from '@heroicons/react/24/outline'
import { fillContractTemplate, type ConsentDisplay } from '@/lib/contract-template-filler'

// ── Field definitions ──

interface FieldDef {
  campo: string
  label: string
  tipo?: 'text' | 'select' | 'readonly' | 'date'
  opciones?: string[]
  soloTitular?: boolean
}

const CAMPOS_TITULAR: FieldDef[] = [
  { campo: 'contrato', label: 'Numero de Contrato', tipo: 'readonly' },
  { campo: 'primerNombre', label: 'Primer Nombre' },
  { campo: 'segundoNombre', label: 'Segundo Nombre' },
  { campo: 'primerApellido', label: 'Primer Apellido' },
  { campo: 'segundoApellido', label: 'Segundo Apellido' },
  { campo: 'numeroId', label: 'Numero de ID' },
  { campo: 'fechaNacimiento', label: 'Fecha de Nacimiento', tipo: 'date' },
  { campo: 'plataforma', label: 'Plataforma', tipo: 'select', opciones: ['Chile', 'Colombia', 'Ecuador', 'Peru', 'Mosaico', 'Internacional'] },
  { campo: 'domicilio', label: 'Domicilio' },
  { campo: 'ciudad', label: 'Ciudad' },
  { campo: 'celular', label: 'Celular' },
  { campo: 'telefono', label: 'Telefono' },
  { campo: 'email', label: 'Email' },
  { campo: 'ingresos', label: 'Ingresos' },
  { campo: 'empresa', label: 'Empresa' },
  { campo: 'cargo', label: 'Cargo' },
  { campo: 'genero', label: 'Genero', tipo: 'select', opciones: ['Masculino', 'Femenino', 'Otro'] },
  { campo: 'medioPago', label: 'Medio de Pago' },
  { campo: 'asesor', label: 'Asesor' },
]

const CAMPOS_REFERENCIAS: FieldDef[] = [
  { campo: 'referenciaUno', label: 'Referencia 1' },
  { campo: 'parentezcoRefUno', label: 'Parentesco Ref 1' },
  { campo: 'telefonoRefUno', label: 'Telefono Ref 1' },
  { campo: 'referenciaDos', label: 'Referencia 2' },
  { campo: 'parentezcoRefDos', label: 'Parentesco Ref 2' },
  { campo: 'telefonoRefDos', label: 'Telefono Ref 2' },
]

const CAMPOS_BENEFICIARIO: FieldDef[] = [
  { campo: 'primerNombre', label: 'Primer Nombre' },
  { campo: 'segundoNombre', label: 'Segundo Nombre' },
  { campo: 'primerApellido', label: 'Primer Apellido' },
  { campo: 'segundoApellido', label: 'Segundo Apellido' },
  { campo: 'numeroId', label: 'Numero de ID' },
  { campo: 'fechaNacimiento', label: 'Fecha de Nacimiento', tipo: 'date' },
  { campo: 'celular', label: 'Celular' },
  { campo: 'email', label: 'Email' },
]

const CAMPOS_FINANCIERO: FieldDef[] = [
  { campo: 'totalPlan', label: 'Total del Plan' },
  { campo: 'pagoInscripcion', label: 'Pago Inscripcion' },
  { campo: 'saldo', label: 'Saldo' },
  { campo: 'numeroCuotas', label: 'Numero de Cuotas' },
  { campo: 'valorCuota', label: 'Valor Cuota' },
  { campo: 'formaPago', label: 'Forma de Pago' },
  { campo: 'fechaPago', label: 'Fecha de Pago', tipo: 'date' },
  { campo: 'medioPago', label: 'Medio de Pago' },
  { campo: 'vigencia', label: 'Vigencia' },
]

// ── Helpers ──

function formatValue(value: any, tipo?: string): string {
  if (value === null || value === undefined || value === '') return '—'
  if (tipo === 'date' && typeof value === 'string') {
    try {
      const d = new Date(value)
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })
      }
    } catch { /* ignore */ }
  }
  return String(value)
}

function formatDateForInput(value: any): string {
  if (!value) return ''
  try {
    const d = new Date(value)
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  } catch { /* ignore */ }
  return String(value)
}

function fullName(person: any): string {
  return [person?.primerNombre, person?.segundoNombre, person?.primerApellido, person?.segundoApellido]
    .filter(Boolean).join(' ')
}

// ── Components ──

function FieldDisplay({ field, value, editing, editValue, onEditChange }: {
  field: FieldDef
  value: any
  editing: boolean
  editValue: any
  onEditChange: (campo: string, val: any) => void
}) {
  if (!editing || field.tipo === 'readonly') {
    return (
      <div>
        <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">{field.label}</dt>
        <dd className="mt-1 text-sm text-gray-900">{formatValue(value, field.tipo)}</dd>
      </div>
    )
  }

  if (field.tipo === 'select' && field.opciones) {
    return (
      <div>
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">{field.label}</label>
        <select
          value={editValue ?? ''}
          onChange={(e) => onEditChange(field.campo, e.target.value)}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
        >
          <option value="">Seleccionar...</option>
          {field.opciones.map((op) => (
            <option key={op} value={op}>{op}</option>
          ))}
        </select>
      </div>
    )
  }

  if (field.tipo === 'date') {
    return (
      <div>
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">{field.label}</label>
        <input
          type="date"
          value={formatDateForInput(editValue)}
          onChange={(e) => onEditChange(field.campo, e.target.value)}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
        />
      </div>
    )
  }

  return (
    <div>
      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">{field.label}</label>
      <input
        type="text"
        value={editValue ?? ''}
        onChange={(e) => onEditChange(field.campo, e.target.value)}
        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
      />
    </div>
  )
}

function SectionCard({ title, icon: Icon, color, children }: {
  title: string
  icon: React.ElementType
  color: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className={`px-4 py-3 ${color} flex items-center gap-2`}>
        <Icon className="h-5 w-5" />
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      <div className="p-4">
        {children}
      </div>
    </div>
  )
}

// ── Main Page ──

export default function ContratoDetailPage() {
  const params = useParams()
  const router = useRouter()
  const titularId = params.id as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')

  // Data
  const [titular, setTitular] = useState<any>(null)
  const [beneficiarios, setBeneficiarios] = useState<any[]>([])
  const [financial, setFinancial] = useState<any>(null)
  const [asesorInfo, setAsesorInfo] = useState<{ nombre?: string; email?: string } | null>(null)

  // Edit state
  const [editTitular, setEditTitular] = useState<Record<string, any>>({})
  const [editBeneficiarios, setEditBeneficiarios] = useState<Record<string, Record<string, any>>>({})
  const [editFinancial, setEditFinancial] = useState<Record<string, any>>({})

  // Contract preview modal
  const [showContractModal, setShowContractModal] = useState(false)
  const [contractHtml, setContractHtml] = useState('')
  const [loadingTemplate, setLoadingTemplate] = useState(false)

  // WhatsApp sending
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false)
  const [whatsAppStatus, setWhatsAppStatus] = useState<'idle' | 'sent' | 'error'>('idle')

  // PDF sending
  const [sendingPdf, setSendingPdf] = useState(false)
  const [pdfStatus, setPdfStatus] = useState<'idle' | 'sent' | 'error'>('idle')

  // Documentación
  const [showDocsModal, setShowDocsModal] = useState(false)
  const [docs, setDocs] = useState<any[]>([])
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]) // filenames in progress

  // Consent status
  const [consentStatus, setConsentStatus] = useState<ConsentDisplay | null>(null)
  const [approvingConsent, setApprovingConsent] = useState(false)
  const [showAutoApproveModal, setShowAutoApproveModal] = useState(false)

  const loadConsentStatus = useCallback(async () => {
    try {
      const data = await api.get(`/api/consent/${titularId}/status`)
      setConsentStatus(data)
    } catch {
      // Consent status is optional — don't block the page
    }
  }, [titularId])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const data = await api.get(`/api/postgres/contracts/${titularId}`)
      setTitular(data.titular)
      setBeneficiarios(data.beneficiarios || [])
      setFinancial(data.financial || null)
      setAsesorInfo(data.asesorInfo || null)
    } catch (err: any) {
      setError(err.message || 'Error cargando contrato')
      handleApiError(err, 'Error cargando contrato')
    } finally {
      setLoading(false)
    }
  }, [titularId])

  useEffect(() => {
    loadData()
    loadConsentStatus()
  }, [loadData, loadConsentStatus])

  // Poll consent status — only after sending WhatsApp, stops after 10 min or when signed
  const [pollingActive, setPollingActive] = useState(false)
  const pollingStartRef = useRef<number>(0)
  const POLLING_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

  useEffect(() => {
    if (!pollingActive || consentStatus?.hasConsent) {
      setPollingActive(false)
      return
    }
    const interval = setInterval(async () => {
      // Stop after 10 minutes
      if (Date.now() - pollingStartRef.current > POLLING_TIMEOUT_MS) {
        setPollingActive(false)
        return
      }
      try {
        const data = await api.get(`/api/consent/${titularId}/status`)
        if (data?.hasConsent) {
          setConsentStatus(data)
          setPollingActive(false)
          toast.success('El cliente ha firmado el consentimiento declarativo')
        }
      } catch { /* ignore polling errors */ }
    }, 15000)
    return () => clearInterval(interval)
  }, [titularId, pollingActive, consentStatus?.hasConsent])

  // Re-generate contract preview when consent status changes
  const templateCacheRef = useRef<string | null>(null)
  useEffect(() => {
    if (showContractModal && templateCacheRef.current && consentStatus?.hasConsent) {
      const filled = fillContractTemplate(
        templateCacheRef.current, titular, beneficiarios, financial,
        consentStatus || undefined, asesorInfo,
      )
      setContractHtml(filled)
    }
  }, [consentStatus, showContractModal, titular, beneficiarios, financial, asesorInfo])

  // Open contract preview modal
  const openContractPreview = async () => {
    if (!titular?.plataforma) {
      toast.error('El titular no tiene plataforma asignada')
      return
    }
    try {
      setLoadingTemplate(true)
      setShowContractModal(true)
      const data = await api.get(
        `/api/postgres/contracts/template?plataforma=${encodeURIComponent(titular.plataforma)}`
      )
      templateCacheRef.current = data.template
      const filled = fillContractTemplate(data.template, titular, beneficiarios, financial, consentStatus || undefined, asesorInfo)
      setContractHtml(filled)
    } catch (err) {
      handleApiError(err, 'Error cargando plantilla del contrato')
      setShowContractModal(false)
    } finally {
      setLoadingTemplate(false)
    }
  }

  // Send contract link via WhatsApp
  const sendContractWhatsApp = async () => {
    const celular = titular?.celular || titular?.telefono
    if (!celular) {
      toast.error('El titular no tiene numero de celular registrado')
      return
    }

    try {
      setSendingWhatsApp(true)
      setWhatsAppStatus('idle')

      // Build the contract URL - use the Wix contract page URL (same as original flow)
      const contractUrl = `https://lgs-plataforma.com/contrato/${titularId}`
      const nombre = titular?.primerNombre || ''

      const message =
        `Hola ${nombre}: \n\n` +
        `*Tu contrato con LetsGoSpeak esta listo!*\n\n` +
        `Para revisarlo sigue este enlace:\n\n` +
        `${contractUrl}\n\n` +
        `Si tienes alguna pregunta, no dudes en contactarnos.`

      await api.post('/api/wix/sendWhatsApp', {
        toNumber: celular,
        messageBody: message,
      })

      toast.success('Contrato enviado por WhatsApp')
      setWhatsAppStatus('sent')
      // Start polling for consent — customer may sign soon
      if (!consentStatus?.hasConsent) {
        pollingStartRef.current = Date.now()
        setPollingActive(true)
      }
    } catch (err) {
      handleApiError(err, 'Error enviando WhatsApp')
      setWhatsAppStatus('error')
    } finally {
      setSendingWhatsApp(false)
    }
  }

  // Send contract PDF via WhatsApp
  const sendContractPdf = async () => {
    try {
      setSendingPdf(true)
      setPdfStatus('idle')
      await api.post(`/api/contracts/${titularId}/send-pdf`, {})
      toast.success('PDF enviado por WhatsApp')
      setPdfStatus('sent')
    } catch (err) {
      handleApiError(err, 'Error enviando PDF')
      setPdfStatus('error')
    } finally {
      setSendingPdf(false)
    }
  }

  // ── Documentación ──
  const loadDocs = useCallback(async () => {
    try {
      setLoadingDocs(true)
      const data = await api.get(`/api/contracts/${titularId}/documents`)
      setDocs(data.documentacion || [])
    } catch (err) {
      handleApiError(err, 'Error cargando documentos')
    } finally {
      setLoadingDocs(false)
    }
  }, [titularId])

  const openDocsModal = () => {
    setShowDocsModal(true)
    loadDocs()
  }

  const handleFileUpload = async (files: File[]) => {
    if (!files.length) return

    for (const file of files) {
      setUploadingFiles(prev => [...prev, file.name])
      try {
        // 1. Upload file through our API (avoids CORS with DO Spaces)
        const formData = new FormData()
        formData.append('file', file)
        const uploadRes = await fetch(`/api/contracts/${titularId}/upload-url`, {
          method: 'POST',
          body: formData,
        })
        if (!uploadRes.ok) {
          const err = await uploadRes.json().catch(() => ({}))
          throw new Error(err.error || `Upload failed: ${uploadRes.status}`)
        }
        const { publicUrl } = await uploadRes.json()

        // 2. Save URL to PEOPLE.documentacion
        const saved = await api.post(`/api/contracts/${titularId}/documents`, {
          url: publicUrl,
          nombre: file.name,
          tipo: file.type,
        })
        setDocs(saved.documentacion || [])
        toast.success(`${file.name} subido`)
      } catch (err) {
        handleApiError(err, `Error subiendo ${file.name}`)
      } finally {
        setUploadingFiles(prev => prev.filter(n => n !== file.name))
      }
    }
  }

  const deleteDoc = async (url: string, nombre: string) => {
    if (!confirm(`¿Eliminar "${nombre}"?`)) return
    try {
      const data = await api.delete(`/api/contracts/${titularId}/documents`, { url })
      setDocs(data.documentacion || [])
      toast.success('Documento eliminado')
    } catch (err) {
      handleApiError(err, 'Error eliminando documento')
    }
  }

  // Auto-approve consent — shows warning modal first
  const autoApproveConsent = () => setShowAutoApproveModal(true)

  const confirmAutoApprove = async () => {
    setShowAutoApproveModal(false)
    try {
      setApprovingConsent(true)
      await api.post(`/api/consent/${titularId}/auto-approve`)
      toast.success('Consentimiento aprobado automáticamente')
      await loadConsentStatus()
    } catch (err) {
      handleApiError(err, 'Error aprobando consentimiento')
    } finally {
      setApprovingConsent(false)
    }
  }

  // Enter edit mode
  const startEditing = () => {
    // Seed edit state with current values
    const titFields: Record<string, any> = {}
    for (const f of [...CAMPOS_TITULAR, ...CAMPOS_REFERENCIAS]) {
      if (f.tipo !== 'readonly') {
        titFields[f.campo] = titular?.[f.campo] ?? ''
      }
    }
    titFields['observacionesContrato'] = titular?.observacionesContrato ?? ''
    setEditTitular(titFields)

    const benEdits: Record<string, Record<string, any>> = {}
    for (const ben of beneficiarios) {
      const fields: Record<string, any> = {}
      for (const f of CAMPOS_BENEFICIARIO) {
        fields[f.campo] = ben[f.campo] ?? ''
      }
      benEdits[ben._id] = fields
    }
    setEditBeneficiarios(benEdits)

    if (financial) {
      const finFields: Record<string, any> = {}
      for (const f of CAMPOS_FINANCIERO) {
        finFields[f.campo] = financial[f.campo] ?? ''
      }
      setEditFinancial(finFields)
    }

    setEditing(true)
  }

  const cancelEditing = () => {
    setEditing(false)
    setEditTitular({})
    setEditBeneficiarios({})
    setEditFinancial({})
  }

  const saveChanges = async () => {
    try {
      setSaving(true)

      // Build changes (only send fields that actually changed)
      const titularChanges: Record<string, any> = {}
      for (const [key, val] of Object.entries(editTitular)) {
        const orig = titular?.[key]
        if (val !== (orig ?? '')) {
          titularChanges[key] = val === '' ? null : val
        }
      }

      const beneficiariosChanges: any[] = []
      for (const [benId, fields] of Object.entries(editBeneficiarios)) {
        const original = beneficiarios.find((b: any) => b._id === benId)
        if (!original) continue
        const changes: Record<string, any> = { _id: benId }
        let hasChanges = false
        for (const [key, val] of Object.entries(fields)) {
          if (val !== (original[key] ?? '')) {
            changes[key] = val === '' ? null : val
            hasChanges = true
          }
        }
        if (hasChanges) beneficiariosChanges.push(changes)
      }

      const financialChanges: Record<string, any> = {}
      if (financial) {
        for (const [key, val] of Object.entries(editFinancial)) {
          const orig = financial[key]
          if (val !== (orig ?? '')) {
            financialChanges[key] = val === '' ? null : val
          }
        }
      }

      const hasAnyChanges =
        Object.keys(titularChanges).length > 0 ||
        beneficiariosChanges.length > 0 ||
        Object.keys(financialChanges).length > 0

      if (!hasAnyChanges) {
        toast('No hay cambios para guardar')
        setEditing(false)
        return
      }

      await api.put(`/api/postgres/contracts/${titularId}`, {
        titular: Object.keys(titularChanges).length > 0 ? titularChanges : undefined,
        beneficiarios: beneficiariosChanges.length > 0 ? beneficiariosChanges : undefined,
        financial: Object.keys(financialChanges).length > 0 ? financialChanges : undefined,
      })

      toast.success('Contrato actualizado exitosamente')
      setEditing(false)
      await loadData()
    } catch (err) {
      handleApiError(err, 'Error guardando cambios')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ──

  if (loading) {
    return (
      <DashboardLayout>
        <div className="max-w-6xl mx-auto animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-4" />
          <div className="h-4 bg-gray-200 rounded w-1/2 mb-8" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-64 bg-gray-100 rounded-lg" />
            ))}
          </div>
        </div>
      </DashboardLayout>
    )
  }

  if (error || !titular) {
    return (
      <DashboardLayout>
        <div className="max-w-6xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <h2 className="text-lg font-semibold text-red-700 mb-2">Error cargando contrato</h2>
            <p className="text-red-600 mb-4">{error || 'No se encontro el titular'}</p>
            <button
              onClick={() => router.back()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Volver
            </button>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={ComercialPermission.MODIFICAR_CONTRATO}>
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <DocumentTextIcon className="h-7 w-7 text-primary-600" />
                Contrato {titular.contrato || '—'}
              </h1>
              <p className="text-gray-500 mt-1">
                Titular: {fullName(titular)} &middot; {titular.numeroId}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={openContractPreview}
                disabled={loadingTemplate}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 text-sm font-medium disabled:opacity-50"
              >
                <EyeIcon className="h-4 w-4" />
                {loadingTemplate ? 'Cargando...' : 'Ver Contrato'}
              </button>
              <button
                onClick={openDocsModal}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-md hover:bg-emerald-200 text-sm font-medium"
              >
                <PaperClipIcon className="h-4 w-4" />
                Subir documentación
              </button>
              {!editing ? (
                <button
                  onClick={startEditing}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 text-sm font-medium"
                >
                  <PencilIcon className="h-4 w-4" />
                  Editar Contrato
                </button>
              ) : (
                <>
                  <button
                    onClick={cancelEditing}
                    disabled={saving}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 text-sm font-medium"
                  >
                    <XMarkIcon className="h-4 w-4" />
                    Cancelar
                  </button>
                  <button
                    onClick={saveChanges}
                    disabled={saving}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium disabled:opacity-50"
                  >
                    <CheckIcon className="h-4 w-4" />
                    {saving ? 'Guardando...' : 'Guardar Cambios'}
                  </button>
                </>
              )}
              {!consentStatus?.hasConsent && (
                <button
                  type="button"
                  onClick={autoApproveConsent}
                  disabled={approvingConsent}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm font-medium disabled:opacity-50"
                >
                  <ShieldCheckIcon className="h-4 w-4" />
                  {approvingConsent ? 'Aprobando...' : 'Auto-Aprobar Consentimiento'}
                </button>
              )}
            </div>
          </div>

          {/* Consent status banner */}
          {consentStatus?.hasConsent && consentStatus.consent && (
            <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <ShieldCheckIcon className="h-6 w-6 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-blue-800 uppercase">
                    Consentimiento Declarativo Verificado
                    {consentStatus.consent.tipoAprobacion === 'AUTOMATICA' && (
                      <span className="ml-2 text-xs font-normal bg-blue-200 text-blue-700 px-2 py-0.5 rounded-full">
                        Aprobacion Automatica
                      </span>
                    )}
                  </h3>
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-blue-700">
                    {consentStatus.consent.numeroDocumento && (
                      <div>
                        <span className="font-medium">Documento:</span>{' '}
                        {consentStatus.consent.numeroDocumento}
                      </div>
                    )}
                    {consentStatus.consent.timestampAcceptacion && (
                      <div>
                        <span className="font-medium">Fecha:</span>{' '}
                        {new Date(consentStatus.consent.timestampAcceptacion).toLocaleString('es-CO')}
                      </div>
                    )}
                    {consentStatus.consent.celularValidado && (
                      <div>
                        <span className="font-medium">Celular:</span>{' '}
                        {consentStatus.consent.celularValidado}
                      </div>
                    )}
                    {consentStatus.hash && (
                      <div>
                        <span className="font-medium">Hash:</span>{' '}
                        {consentStatus.hash.substring(0, 16)}...
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Contract sections grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Titular - Datos Personales */}
            <SectionCard
              title="Datos del Titular"
              icon={UserIcon}
              color="bg-blue-50 text-blue-800"
            >
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                {CAMPOS_TITULAR.map((field) => (
                  <FieldDisplay
                    key={field.campo}
                    field={field}
                    value={titular[field.campo]}
                    editing={editing}
                    editValue={editTitular[field.campo]}
                    onEditChange={(campo, val) => setEditTitular(prev => ({ ...prev, [campo]: val }))}
                  />
                ))}
              </dl>
            </SectionCard>

            {/* Referencias */}
            <SectionCard
              title="Referencias"
              icon={PhoneIcon}
              color="bg-purple-50 text-purple-800"
            >
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                {CAMPOS_REFERENCIAS.map((field) => (
                  <FieldDisplay
                    key={field.campo}
                    field={field}
                    value={titular[field.campo]}
                    editing={editing}
                    editValue={editTitular[field.campo]}
                    onEditChange={(campo, val) => setEditTitular(prev => ({ ...prev, [campo]: val }))}
                  />
                ))}
              </dl>
              {/* Observaciones */}
              <div className="mt-4 pt-4 border-t border-gray-100">
                <FieldDisplay
                  field={{ campo: 'observacionesContrato', label: 'Observaciones del Contrato' }}
                  value={titular.observacionesContrato}
                  editing={editing}
                  editValue={editTitular['observacionesContrato']}
                  onEditChange={(campo, val) => setEditTitular(prev => ({ ...prev, [campo]: val }))}
                />
              </div>
            </SectionCard>

            {/* Beneficiarios */}
            <SectionCard
              title={`Beneficiarios (${beneficiarios.length})`}
              icon={UsersIcon}
              color="bg-green-50 text-green-800"
            >
              {beneficiarios.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No hay beneficiarios registrados</p>
              ) : (
                <div className="space-y-4">
                  {beneficiarios.map((ben: any, idx: number) => (
                    <div key={ben._id} className={idx > 0 ? 'pt-4 border-t border-gray-100' : ''}>
                      <p className="text-xs font-semibold text-green-700 mb-2">
                        Beneficiario {idx + 1}: {fullName(ben)}
                      </p>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                        {CAMPOS_BENEFICIARIO.map((field) => (
                          <FieldDisplay
                            key={`${ben._id}-${field.campo}`}
                            field={field}
                            value={ben[field.campo]}
                            editing={editing}
                            editValue={editBeneficiarios[ben._id]?.[field.campo]}
                            onEditChange={(campo, val) =>
                              setEditBeneficiarios(prev => ({
                                ...prev,
                                [ben._id]: { ...prev[ben._id], [campo]: val }
                              }))
                            }
                          />
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* Financiero */}
            <SectionCard
              title="Informacion Financiera"
              icon={BanknotesIcon}
              color="bg-amber-50 text-amber-800"
            >
              {!financial ? (
                <p className="text-sm text-gray-500 italic">No hay datos financieros registrados</p>
              ) : (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  {CAMPOS_FINANCIERO.map((field) => (
                    <FieldDisplay
                      key={field.campo}
                      field={field}
                      value={financial[field.campo]}
                      editing={editing}
                      editValue={editFinancial[field.campo]}
                      onEditChange={(campo, val) => setEditFinancial(prev => ({ ...prev, [campo]: val }))}
                    />
                  ))}
                </dl>
              )}
            </SectionCard>

          </div>

          {/* Contract info footer */}
          <div className="mt-6 bg-gray-50 rounded-lg border border-gray-200 p-4 text-xs text-gray-500">
            <div className="flex flex-wrap gap-4">
              {titular._createdDate && (
                <span className="flex items-center gap-1">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  Creado: {new Date(titular._createdDate).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
              )}
              {titular._updatedDate && (
                <span className="flex items-center gap-1">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  Actualizado: {new Date(titular._updatedDate).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
              )}
              <span className="flex items-center gap-1">
                <IdentificationIcon className="h-3.5 w-3.5" />
                ID: {titular._id}
              </span>
            </div>
          </div>

          {/* ── Contract Preview Modal ── */}
          {showContractModal && (
            <div className="fixed inset-0 z-50 overflow-y-auto">
              <div className="flex min-h-full items-start justify-center p-4 pt-10">
                {/* Backdrop */}
                <div
                  className="fixed inset-0 bg-black/50 transition-opacity"
                  onClick={() => setShowContractModal(false)}
                />

                {/* Modal panel */}
                <div className="relative w-full max-w-4xl bg-white rounded-xl shadow-2xl">
                  {/* Modal header */}
                  <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 rounded-t-xl">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">
                        Contrato {titular.contrato}
                      </h2>
                      <p className="text-sm text-gray-500">
                        Plataforma: {titular.plataforma} &middot; {fullName(titular)}
                      </p>
                    </div>
                    <button
                      type="button"
                      title="Cerrar"
                      onClick={() => setShowContractModal(false)}
                      className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
                    >
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  {/* Modal body */}
                  <div className="px-8 py-6 max-h-[75vh] overflow-y-auto">
                    {loadingTemplate ? (
                      <div className="flex items-center justify-center py-20">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
                      </div>
                    ) : (
                      <div className="prose prose-sm max-w-none whitespace-pre-wrap font-serif text-gray-800 leading-relaxed">
                        {contractHtml}
                      </div>
                    )}
                  </div>

                  {/* Modal footer */}
                  <div className="sticky bottom-0 flex items-center justify-between px-6 py-4 bg-gray-50 border-t border-gray-200 rounded-b-xl">
                    {/* WhatsApp status */}
                    <div className="text-sm">
                      {whatsAppStatus === 'sent' && (
                        <span className="text-green-600 font-medium">Enviado por WhatsApp</span>
                      )}
                      {whatsAppStatus === 'error' && (
                        <span className="text-red-600 font-medium">Error al enviar</span>
                      )}
                      {pdfStatus === 'sent' && (
                        <span className="text-blue-600 font-medium">PDF enviado</span>
                      )}
                      {pdfStatus === 'error' && (
                        <span className="text-red-600 font-medium">Error al enviar PDF</span>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => {
                          if (typeof window !== 'undefined') {
                            const printWindow = window.open('', '_blank')
                            if (printWindow) {
                              printWindow.document.write(`
                                <html>
                                  <head>
                                    <title>Contrato ${titular.contrato}</title>
                                    <style>
                                      body { font-family: Georgia, serif; padding: 40px; line-height: 1.6; white-space: pre-wrap; font-size: 14px; color: #1a1a1a; }
                                      @media print { body { padding: 20px; } }
                                    </style>
                                  </head>
                                  <body>${contractHtml.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</body>
                                </html>
                              `)
                              printWindow.document.close()
                              printWindow.print()
                            }
                          }
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-100 text-sm font-medium"
                      >
                        Imprimir
                      </button>
                      <button
                        onClick={sendContractWhatsApp}
                        disabled={sendingWhatsApp || !titular?.celular}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        title={!titular?.celular ? 'El titular no tiene celular registrado' : ''}
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                        </svg>
                        {sendingWhatsApp ? 'Enviando...' : 'Solicitar firma'}
                      </button>
                      <button
                        onClick={sendContractPdf}
                        disabled={sendingPdf || !titular?.celular}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        title={!titular?.celular ? 'El titular no tiene celular registrado' : 'Genera el PDF y lo envía por WhatsApp (~15s)'}
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                        </svg>
                        {sendingPdf ? 'Generando PDF...' : 'Enviar PDF'}
                      </button>
                      <button
                        onClick={() => setShowContractModal(false)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 text-sm font-medium"
                      >
                        Cerrar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Documentación Modal ── */}
        {showDocsModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-screen items-center justify-center p-4">
              <div className="fixed inset-0 bg-black/50" onClick={() => setShowDocsModal(false)} />
              <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                  <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <PaperClipIcon className="h-5 w-5 text-gray-500" />
                    Documentación del contrato
                  </h2>
                  <button type="button" title="Cerrar" onClick={() => setShowDocsModal(false)} className="text-gray-400 hover:text-gray-600">
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                {/* Body */}
                <div className="px-6 py-5 space-y-4">
                  {/* Upload zone */}
                  <div
                    className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-primary-400 transition-colors cursor-pointer"
                    onClick={() => {
                      const input = document.createElement('input')
                      input.type = 'file'
                      input.multiple = true
                      input.accept = 'image/jpeg,image/jpg,image/png,image/webp,image/heic,application/pdf'
                      input.style.display = 'none'
                      document.body.appendChild(input)
                      input.addEventListener('change', () => {
                        handleFileUpload(Array.from(input.files || []))
                        document.body.removeChild(input)
                      })
                      input.click()
                    }}
                  >
                    <ArrowUpTrayIcon className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm font-medium text-gray-700">Haz clic para subir archivos</p>
                    <p className="text-xs text-gray-400 mt-1">JPG, PNG, WEBP, HEIC, PDF · Máx 20 MB por archivo</p>
                  </div>

                  {/* Uploading progress */}
                  {uploadingFiles.length > 0 && (
                    <div className="space-y-1">
                      {uploadingFiles.map(name => (
                        <div key={name} className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 rounded px-3 py-2">
                          <div className="animate-spin h-3 w-3 border-2 border-blue-400 border-t-transparent rounded-full flex-shrink-0" />
                          Subiendo {name}…
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Document list */}
                  {loadingDocs ? (
                    <div className="flex justify-center py-6">
                      <div className="animate-spin h-6 w-6 border-2 border-primary-500 border-t-transparent rounded-full" />
                    </div>
                  ) : docs.length === 0 ? (
                    <p className="text-center text-sm text-gray-400 py-4">Sin documentos aún</p>
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {docs.map((doc: any, i: number) => (
                        <li key={i} className="flex items-center gap-3 py-2.5">
                          {doc.tipo?.startsWith('image/') ? (
                            <img src={doc.url} alt={doc.nombre} className="h-10 w-10 rounded object-cover flex-shrink-0 border border-gray-200" />
                          ) : (
                            <div className="h-10 w-10 rounded bg-red-50 flex items-center justify-center flex-shrink-0 border border-red-100">
                              <DocumentTextIcon className="h-5 w-5 text-red-400" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-gray-800 hover:text-primary-600 truncate block">
                              {doc.nombre}
                            </a>
                            <p className="text-xs text-gray-400">{new Date(doc.fechaSubida).toLocaleString('es-CO')}</p>
                          </div>
                          <button
                            onClick={() => deleteDoc(doc.url, doc.nombre)}
                            className="text-gray-300 hover:text-red-500 flex-shrink-0"
                            title="Eliminar"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
                  <button onClick={() => setShowDocsModal(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 text-sm font-medium">
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </PermissionGuard>

      {/* ── Auto-Aprobar Consentimiento — Modal de advertencia ── */}
      {showAutoApproveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden">
            {/* Header rojo */}
            <div className="bg-red-600 px-6 py-4 flex items-center gap-3">
              <div className="flex-shrink-0 bg-white bg-opacity-20 rounded-full p-2">
                <ShieldCheckIcon className="h-6 w-6 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white uppercase tracking-wide">⚠️ ADVERTENCIA</h2>
                <p className="text-red-100 text-sm">Acción restringida — Área de Tecnología</p>
              </div>
            </div>

            {/* Cuerpo */}
            <div className="px-6 py-5 space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800 leading-relaxed">
                <p className="font-semibold mb-2">Este proceso es de uso exclusivo del Área de Tecnología.</p>
                <p>
                  La auto-aprobación de consentimiento omite la verificación OTP del cliente y genera
                  registros de auditoría que quedan grabados con su identificación, fecha, hora
                  y número de contrato.
                </p>
              </div>
              <p className="text-gray-700 text-sm">
                Para continuar, debe contar con autorización expresa del <strong>Área de Tecnología</strong>.
                Si no la tiene, haga clic en <strong>No, cancelar</strong>.
              </p>
              <p className="text-gray-500 text-xs">
                Contrato: <span className="font-mono font-semibold">{titular?.contrato || '—'}</span>
              </p>
            </div>

            {/* Acciones */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowAutoApproveModal(false)}
                className="px-5 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 text-sm font-medium"
              >
                No, cancelar
              </button>
              <button
                type="button"
                onClick={confirmAutoApprove}
                className="px-5 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-semibold"
              >
                Sí, tengo autorización — Continuar
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}
