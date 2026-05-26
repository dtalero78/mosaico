'use client'

import { useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { ArrowLeftIcon, ArrowRightIcon, PlusIcon, TrashIcon, CheckCircleIcon } from '@heroicons/react/24/outline'

// ─── Constantes ──────────────────────────────────────────────────────────────

const COUNTRY_PREFIXES = [
  { country: 'Argentina',          prefix: '+54'    },
  { country: 'Australia',          prefix: '+61'    },
  { country: 'Bolivia',            prefix: '+591'   },
  { country: 'Chile',              prefix: '+56'    },
  { country: 'Colombia',           prefix: '+57'    },
  { country: 'Costa Rica',         prefix: '+506'   },
  { country: 'Cuba',               prefix: '+53'    },
  { country: 'Ecuador',            prefix: '+593'   },
  { country: 'El Salvador',        prefix: '+503'   },
  { country: 'España',             prefix: '+34'    },
  { country: 'Estados Unidos',     prefix: '+1'     },
  { country: 'Guatemala',          prefix: '+502'   },
  { country: 'Honduras',           prefix: '+504'   },
  { country: 'México',             prefix: '+52'    },
  { country: 'Nicaragua',          prefix: '+505'   },
  { country: 'Panamá',             prefix: '+507'   },
  { country: 'Paraguay',           prefix: '+595'   },
  { country: 'Perú',               prefix: '+51'    },
  { country: 'Puerto Rico',        prefix: '+1 787' },
  { country: 'República Dominicana', prefix: '+1 809' },
  { country: 'Uruguay',            prefix: '+598'   },
  { country: 'Venezuela',          prefix: '+58'    },
  { country: 'Otro',               prefix: ''       },
]

const PAYMENT_OPTIONS: Record<string, { label: string; value: string }[]> = {
  Colombia:  [{ label: 'Transferencia', value: 'Transferencia' }, { label: 'Epayco', value: 'Epayco' }, { label: 'Paypal', value: 'Paypal' }],
  Ecuador:   [{ label: 'Transferencia', value: 'Transferencia' }, { label: 'Datafast', value: 'Datafast' }, { label: 'Paypal', value: 'Paypal' }],
  Chile:     [{ label: 'Transferencia', value: 'Transferencia' }, { label: 'Webpay', value: 'Webpay' }, { label: 'Paypal', value: 'Paypal' }],
  Perú:      [{ label: 'Transferencia', value: 'Transferencia' }, { label: 'Niubiz', value: 'Niubiz' }],
}

const PLATAFORMAS = ['Colombia', 'Chile', 'Ecuador', 'Perú']

const STEP_LABELS = [
  'Contrato',
  'Titular',
  'Ubicación',
  'Adicional',
  'Referencias',
  'Financiero',
  'Beneficiarios',
  'Confirmación',
]

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface Beneficiario {
  primerNombre: string
  segundoNombre: string
  primerApellido: string
  segundoApellido: string
  numeroId: string
  fechaNacimiento: string
  email: string
  celular: string
  domicilio: string
  ciudad: string
}

const emptyBeneficiario = (): Beneficiario => ({
  primerNombre: '', segundoNombre: '', primerApellido: '', segundoApellido: '',
  numeroId: '', fechaNacimiento: '', email: '', celular: '', domicilio: '', ciudad: '',
})

// ─── Componente ──────────────────────────────────────────────────────────────

export default function MigrarContratoPage() {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [titularId, setTitularId] = useState('')

  // Step 1 – Contrato
  const [contrato, setContrato] = useState('')
  const [plataforma, setPlataforma] = useState('')
  const [asesor, setAsesor] = useState('')

  // Steps 2-5 – Titular
  const [titular, setTitular] = useState({
    primerNombre: '', segundoNombre: '', primerApellido: '', segundoApellido: '',
    numeroId: '', fechaNacimiento: '', pais: 'Colombia',
    domicilio: '', ciudad: '', celular: '', telefono: '',
    email: '', ingresos: '', empresa: '', cargo: '', genero: '',
    referenciaUno: '', parentezcoRefUno: '', telRefUno: '',
    referenciaDos: '', parentezcoRefDos: '', telRefDos: '',
  })

  // Step 6 – Financiero
  const [financial, setFinancial] = useState({
    totalPlan: 0, pagoInscripcion: 0, saldo: 0,
    numeroCuotas: 0, valorCuota: 0,
    fechaPago: '', fechaContrato: '', finalContrato: '',
    vigencia: '', medioPago: '', plan: '',
  })

  // Step 7 – Beneficiarios
  const [titularEsBeneficiario, setTitularEsBeneficiario] = useState(false)
  const [beneficiarios, setBeneficiarios] = useState<Beneficiario[]>([])

  // Estado del formulario inline de beneficiario en curso
  const [addingBenef, setAddingBenef] = useState(false)
  const [currentBenef, setCurrentBenef] = useState<Beneficiario>(emptyBeneficiario())
  const [benError, setBenError] = useState('')

  // Modal "¿Agregar otro?"
  const [showAnotherModal, setShowAnotherModal] = useState(false)

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const getPhonePrefix = () => {
    const found = COUNTRY_PREFIXES.find(c => c.country === titular.pais)
    return (found?.prefix || '').replace(/\+/g, '').replace(/\s/g, '')
  }

  const getPaymentOptions = () => PAYMENT_OPTIONS[plataforma] || PAYMENT_OPTIONS['Colombia']

  const recalcFinancial = (updates: Partial<typeof financial>) => {
    const merged = { ...financial, ...updates }
    const saldo = (Number(merged.totalPlan) || 0) - (Number(merged.pagoInscripcion) || 0)
    const cuotas = Number(merged.numeroCuotas) || 0
    const valorCuota = cuotas > 0 ? Math.round(saldo / cuotas) : 0
    setFinancial({ ...merged, saldo, valorCuota })
  }

  const fmt = (v: string | number): string => {
    const n = typeof v === 'string' ? parseInt(v.replace(/\D/g, ''), 10) : Math.round(Number(v))
    if (!n || isNaN(n)) return ''
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  }

  const parseFmt = (v: string): number => parseInt(v.replace(/\D/g, ''), 10) || 0

  // ─── Validación por paso ────────────────────────────────────────────────────

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  const validate = (s: number): string => {
    switch (s) {
      case 1:
        if (!contrato.trim()) return 'El número de contrato es requerido'
        if (!plataforma) return 'La plataforma es requerida'
        if (!asesor.trim()) return 'El nombre del asesor es requerido'
        return ''
      case 2:
        if (!titular.primerNombre.trim()) return 'El primer nombre es requerido'
        if (!titular.primerApellido.trim()) return 'El primer apellido es requerido'
        if (!titular.numeroId.trim()) return 'El número de ID es requerido'
        return ''
      case 3:
        if (!titular.fechaNacimiento) return 'La fecha de nacimiento es requerida'
        if (!titular.domicilio.trim()) return 'El domicilio es requerido'
        if (!titular.ciudad.trim()) return 'La ciudad es requerida'
        if (!titular.celular.trim()) return 'El celular es requerido'
        return ''
      case 4:
        if (!titular.email.trim()) return 'El email es requerido'
        if (!EMAIL_RE.test(titular.email.trim())) return 'El email no tiene un formato válido'
        if (!titular.genero) return 'El género es requerido'
        return ''
      case 5:
        if (!titular.referenciaUno.trim()) return 'La referencia 1 es requerida'
        if (!titular.parentezcoRefUno.trim()) return 'El parentesco de la referencia 1 es requerido'
        if (!titular.telRefUno.trim()) return 'El teléfono de la referencia 1 es requerido'
        return ''
      case 6:
        if (!financial.totalPlan) return 'El valor del plan es requerido'
        if (!financial.fechaPago) return 'La fecha de pago es requerida'
        if (!financial.vigencia) return 'La vigencia es requerida'
        if (parseInt(financial.vigencia) < 1 || parseInt(financial.vigencia) > 12)
          return 'La vigencia debe ser entre 1 y 12 meses'
        if (!financial.medioPago) return 'El medio de pago es requerido'
        return ''
      case 7:
        if (!titularEsBeneficiario && beneficiarios.length === 0)
          return 'Debe haber al menos un beneficiario. Active el toggle del titular o agregue uno adicional.'
        return ''
      default:
        return ''
    }
  }

  const handleNext = () => {
    const msg = validate(step)
    if (msg) { setError(msg); return }
    setError('')
    setStep(s => s + 1)
  }

  const handlePrev = () => { setError(''); setStep(s => s - 1) }

  // ─── Beneficiario inline ────────────────────────────────────────────────────

  const validateBenef = (): string => {
    if (!currentBenef.primerNombre.trim()) return 'El primer nombre es requerido'
    if (!currentBenef.primerApellido.trim()) return 'El primer apellido es requerido'
    if (!currentBenef.numeroId.trim()) return 'El número de ID es requerido'
    return ''
  }

  const confirmBenef = () => {
    const msg = validateBenef()
    if (msg) { setBenError(msg); return }
    setBenError('')
    setBeneficiarios(prev => [...prev, { ...currentBenef }])
    setCurrentBenef(emptyBeneficiario())
    setAddingBenef(false)
    setShowAnotherModal(true)
  }

  const cancelBenef = () => {
    setCurrentBenef(emptyBeneficiario())
    setAddingBenef(false)
    setBenError('')
  }

  // ─── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    setLoading(true)
    setError('')
    try {
      const prefix = getPhonePrefix()
      const res = await fetch('/api/admin/migrar-contrato', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contrato,
          titular: {
            ...titular,
            asesor,
            plataforma,
            celular: prefix ? prefix + titular.celular : titular.celular,
          },
          financial,
          beneficiarios: beneficiarios.map(b => ({
            ...b,
            celular: b.celular ? (prefix ? prefix + b.celular : b.celular) : null,
          })),
          titularEsBeneficiario,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al migrar el contrato')

      setTitularId(data.titularId)
      setStep(9) // paso final: éxito
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ─── Conteo de beneficiarios confirmados ────────────────────────────────────
  const totalBenef = (titularEsBeneficiario ? 1 : 0) + beneficiarios.length

  // ─── Render ────────────────────────────────────────────────────────────────

  if (step === 9) {
    return (
      <DashboardLayout>
        <div className="max-w-2xl mx-auto mt-20 text-center space-y-6">
          <CheckCircleIcon className="w-20 h-20 text-green-500 mx-auto" />
          <h1 className="text-3xl font-bold text-gray-900">¡Contrato migrado exitosamente!</h1>
          <p className="text-gray-600">Contrato <strong>{contrato}</strong> creado con {totalBenef} beneficiario(s).</p>
          <button
            type="button"
            onClick={() => window.open(`/dashboard/comercial/contrato/${titularId}`, '_blank', 'noopener,noreferrer')}
            className="px-6 py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700"
          >
            Ver Contrato
          </button>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Migrar Contrato</h1>
          <p className="text-sm text-gray-500 mt-1">Crea el titular y beneficiarios con número de contrato manual</p>
        </div>

        {/* Progress */}
        <div className="mb-8 overflow-x-auto">
          <div className="flex min-w-max">
            {STEP_LABELS.map((label, i) => {
              const s = i + 1
              return (
                <div key={s} className={`flex-1 ${s < STEP_LABELS.length ? 'border-b-2' : ''} ${s <= step ? 'border-primary-600' : 'border-gray-200'} pb-3 pr-2`}>
                  <div className={`w-8 h-8 mx-auto rounded-full flex items-center justify-center text-sm font-medium ${s < step ? 'bg-primary-600 text-white' : s === step ? 'bg-primary-600 text-white ring-4 ring-primary-100' : 'bg-gray-200 text-gray-500'}`}>
                    {s < step ? '✓' : s}
                  </div>
                  <p className="text-xs text-center mt-1 text-gray-600 whitespace-nowrap">{label}</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* Card */}
        <div className="bg-white shadow rounded-lg p-6">

          {/* ── PASO 1: Datos del Contrato ────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Datos del Contrato</h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Número de contrato *</label>
                <input
                  type="text"
                  value={contrato}
                  onChange={e => setContrato(e.target.value.toUpperCase())}
                  placeholder="Ej: 01-12345-26"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
                <p className="text-xs text-gray-500 mt-1">Ingresa el número de contrato exactamente como aparece en el contrato original.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Plataforma / País *</label>
                <select
                  value={plataforma}
                  onChange={e => setPlataforma(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="">Seleccionar...</option>
                  {PLATAFORMAS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Asesor *</label>
                <input
                  type="text"
                  value={asesor}
                  onChange={e => setAsesor(e.target.value)}
                  placeholder="Nombre del asesor"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>
          )}

          {/* ── PASO 2: Datos Básicos del Titular ────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Datos Básicos del Titular</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { label: 'Primer Nombre *', field: 'primerNombre', placeholder: 'Ej: Juan' },
                  { label: 'Segundo Nombre', field: 'segundoNombre', placeholder: 'Ej: Carlos' },
                  { label: 'Primer Apellido *', field: 'primerApellido', placeholder: 'Ej: Pérez' },
                  { label: 'Segundo Apellido', field: 'segundoApellido', placeholder: 'Ej: García' },
                ].map(({ label, field, placeholder }) => (
                  <div key={field}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                    <input
                      type="text"
                      value={(titular as any)[field]}
                      onChange={e => setTitular(t => ({ ...t, [field]: e.target.value }))}
                      placeholder={placeholder}
                      title={label.replace(' *', '')}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                ))}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Número de ID *</label>
                  <input
                    type="text"
                    value={titular.numeroId}
                    onChange={e => setTitular(t => ({ ...t, numeroId: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))}
                    onKeyDown={e => { if (!/[A-Za-z0-9]/.test(e.key) && !['Backspace','Delete','Tab','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault() }}
                    placeholder="Solo letras mayúsculas y números"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── PASO 3: Ubicación ─────────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Ubicación y Contacto</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de Nacimiento *</label>
                  <input type="date" value={titular.fechaNacimiento} onChange={e => setTitular(t => ({ ...t, fechaNacimiento: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">País de residencia</label>
                  <select value={titular.pais} onChange={e => setTitular(t => ({ ...t, pais: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500">
                    {COUNTRY_PREFIXES.map(c => <option key={c.country} value={c.country}>{c.country}</option>)}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Domicilio *</label>
                  <input type="text" value={titular.domicilio} onChange={e => setTitular(t => ({ ...t, domicilio: e.target.value }))}
                    placeholder="Dirección completa"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ciudad *</label>
                  <input type="text" value={titular.ciudad} onChange={e => setTitular(t => ({ ...t, ciudad: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Celular * {getPhonePrefix() && <span className="text-gray-400">({getPhonePrefix()})</span>}
                  </label>
                  <input type="text" value={titular.celular} onChange={e => setTitular(t => ({ ...t, celular: e.target.value.replace(/\D/g, '') }))}
                    placeholder="Solo dígitos sin prefijo"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono fijo</label>
                  <input type="text" value={titular.telefono} onChange={e => setTitular(t => ({ ...t, telefono: e.target.value.replace(/\D/g, '') }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                </div>
              </div>
            </div>
          )}

          {/* ── PASO 4: Datos Adicionales ─────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Datos Adicionales</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                  <input type="email" value={titular.email} onChange={e => setTitular(t => ({ ...t, email: e.target.value.toLowerCase() }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Género *</label>
                  <select value={titular.genero} onChange={e => setTitular(t => ({ ...t, genero: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500">
                    <option value="">Seleccionar...</option>
                    <option value="Masculino">Masculino</option>
                    <option value="Femenino">Femenino</option>
                    <option value="Otro">Otro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ingresos mensuales</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium select-none">$</span>
                    <input type="text"
                      value={titular.ingresos ? fmt(titular.ingresos) : ''}
                      onChange={e => setTitular(t => ({ ...t, ingresos: String(parseFmt(e.target.value) || '') }))}
                      placeholder="0"
                      title="Ingresos mensuales"
                      className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Empresa</label>
                  <input type="text" value={titular.empresa} onChange={e => setTitular(t => ({ ...t, empresa: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cargo</label>
                  <input type="text" value={titular.cargo} onChange={e => setTitular(t => ({ ...t, cargo: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                </div>
              </div>
            </div>
          )}

          {/* ── PASO 5: Referencias ───────────────────────────────────────── */}
          {step === 5 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Referencias Personales</h2>
              <div className="p-4 bg-gray-50 rounded-lg space-y-3">
                <p className="text-sm font-medium text-gray-700">Referencia 1 *</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Nombre completo *</label>
                    <input type="text" value={titular.referenciaUno} onChange={e => setTitular(t => ({ ...t, referenciaUno: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Parentesco *</label>
                    <input type="text" value={titular.parentezcoRefUno} onChange={e => setTitular(t => ({ ...t, parentezcoRefUno: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Teléfono *</label>
                    <input type="text" value={titular.telRefUno} onChange={e => setTitular(t => ({ ...t, telRefUno: e.target.value.replace(/\D/g, '') }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                  </div>
                </div>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg space-y-3">
                <p className="text-sm font-medium text-gray-700">Referencia 2 (opcional)</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Nombre completo</label>
                    <input type="text" value={titular.referenciaDos} onChange={e => setTitular(t => ({ ...t, referenciaDos: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Parentesco</label>
                    <input type="text" value={titular.parentezcoRefDos} onChange={e => setTitular(t => ({ ...t, parentezcoRefDos: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Teléfono</label>
                    <input type="text" value={titular.telRefDos} onChange={e => setTitular(t => ({ ...t, telRefDos: e.target.value.replace(/\D/g, '') }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── PASO 6: Financiero ────────────────────────────────────────── */}
          {step === 6 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Datos Financieros</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Valor total del plan *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium select-none">$</span>
                    <input type="text"
                      value={financial.totalPlan ? fmt(financial.totalPlan) : ''}
                      onChange={e => recalcFinancial({ totalPlan: parseFmt(e.target.value) })}
                      placeholder="0"
                      title="Valor total del plan"
                      className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cuota inicial / Pago de inscripción</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium select-none">$</span>
                    <input type="text"
                      value={financial.pagoInscripcion ? fmt(financial.pagoInscripcion) : ''}
                      onChange={e => recalcFinancial({ pagoInscripcion: parseFmt(e.target.value) })}
                      placeholder="0"
                      title="Cuota inicial"
                      className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Saldo (calculado)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium select-none">$</span>
                    <input type="text" readOnly
                      value={financial.saldo ? fmt(financial.saldo) : '0'}
                      title="Saldo"
                      className="w-full pl-7 pr-3 py-2 border border-gray-200 bg-gray-50 rounded-md text-gray-600" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Número de cuotas</label>
                  <input type="number" min={0} value={financial.numeroCuotas || ''}
                    onChange={e => recalcFinancial({ numeroCuotas: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Valor de cuota (calculado)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium select-none">$</span>
                    <input type="text" readOnly
                      value={financial.valorCuota ? fmt(financial.valorCuota) : '0'}
                      title="Valor de cuota"
                      className="w-full pl-7 pr-3 py-2 border border-gray-200 bg-gray-50 rounded-md text-gray-600" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vigencia (meses) * <span className="text-gray-400 font-normal">(máx. 12)</span></label>
                  <input type="number" min={1} max={12} value={financial.vigencia || ''}
                    onChange={e => setFinancial(f => ({ ...f, vigencia: e.target.value }))}
                    onKeyDown={e => { if (!/[0-9]/.test(e.key) && !['Backspace','Delete','Tab','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault() }}
                    onBlur={e => {
                      const v = parseInt(e.target.value) || 0
                      if (v < 1) setFinancial(f => ({ ...f, vigencia: '1' }))
                      if (v > 12) setFinancial(f => ({ ...f, vigencia: '12' }))
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Medio de pago *</label>
                  <select value={financial.medioPago} onChange={e => setFinancial(f => ({ ...f, medioPago: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500">
                    <option value="">Seleccionar...</option>
                    {getPaymentOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de primer pago *</label>
                  <input type="date" value={financial.fechaPago} onChange={e => setFinancial(f => ({ ...f, fechaPago: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de contrato (firma)</label>
                  <input type="date" value={financial.fechaContrato} onChange={e => setFinancial(f => ({ ...f, fechaContrato: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fecha final del contrato (opcional)</label>
                  <input type="date" value={financial.finalContrato} onChange={e => setFinancial(f => ({ ...f, finalContrato: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                  <p className="text-xs text-gray-500 mt-1">Si se deja vacío se calcula desde la fecha de contrato + vigencia.</p>
                </div>
                <div>
                  <label htmlFor="mig-tipo-plan" className="block text-sm font-medium text-gray-700 mb-1">Tipo Plan</label>
                  <select
                    id="mig-tipo-plan"
                    value={financial.plan}
                    onChange={e => setFinancial(f => ({ ...f, plan: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="">— Selecciona —</option>
                    <option value="Contado">Contado</option>
                    <option value="Credito">Credito</option>
                    <option value="Colaborador">Colaborador</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* ── PASO 7: Beneficiarios ─────────────────────────────────────── */}
          {step === 7 && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">Beneficiarios</h2>

              {/* Toggle titular como beneficiario */}
              <div className="flex items-center justify-between p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div>
                  <p className="font-medium text-blue-900">¿El titular también es beneficiario?</p>
                  <p className="text-sm text-blue-700 mt-0.5">
                    {titular.primerNombre} {titular.primerApellido} — ID: {titular.numeroId}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTitularEsBeneficiario(v => !v)}
                  className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors focus:outline-none ${titularEsBeneficiario ? 'bg-blue-600' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${titularEsBeneficiario ? 'translate-x-8' : 'translate-x-1'}`} />
                </button>
              </div>

              {/* Lista de beneficiarios confirmados */}
              {(titularEsBeneficiario || beneficiarios.length > 0) && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700">Beneficiarios confirmados ({totalBenef}):</p>
                  {titularEsBeneficiario && (
                    <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm">
                      <span className="font-medium text-blue-800">{titular.primerNombre} {titular.primerApellido}</span>
                      <span className="text-blue-600 text-xs">Titular (duplicado como beneficiario)</span>
                    </div>
                  )}
                  {beneficiarios.map((b, i) => (
                    <div key={i} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm">
                      <span className="font-medium">{b.primerNombre} {b.primerApellido} — ID: {b.numeroId}</span>
                      <button
                        type="button"
                        onClick={() => setBeneficiarios(prev => prev.filter((_, idx) => idx !== i))}
                        className="text-red-500 hover:text-red-700 ml-4"
                        title="Eliminar"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Formulario inline para nuevo beneficiario */}
              {addingBenef && (
                <div className="border border-primary-200 rounded-lg p-4 bg-primary-50 space-y-4">
                  <p className="text-sm font-semibold text-primary-800">Datos del nuevo beneficiario</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[
                      { label: 'Primer Nombre *', field: 'primerNombre', placeholder: 'Ej: Juan' },
                      { label: 'Segundo Nombre', field: 'segundoNombre', placeholder: 'Ej: Carlos' },
                      { label: 'Primer Apellido *', field: 'primerApellido', placeholder: 'Ej: Pérez' },
                      { label: 'Segundo Apellido', field: 'segundoApellido', placeholder: 'Ej: García' },
                    ].map(({ label, field, placeholder }) => (
                      <div key={field}>
                        <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
                        <input type="text"
                          value={(currentBenef as any)[field]}
                          onChange={e => setCurrentBenef(b => ({ ...b, [field]: e.target.value }))}
                          placeholder={placeholder}
                          title={label.replace(' *', '')}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                      </div>
                    ))}
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Número de ID *</label>
                      <input type="text"
                        value={currentBenef.numeroId}
                        onChange={e => setCurrentBenef(b => ({ ...b, numeroId: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Fecha de nacimiento</label>
                      <input type="date"
                        value={currentBenef.fechaNacimiento}
                        onChange={e => setCurrentBenef(b => ({ ...b, fechaNacimiento: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                      <input type="email"
                        value={currentBenef.email}
                        onChange={e => setCurrentBenef(b => ({ ...b, email: e.target.value.toLowerCase() }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Celular {getPhonePrefix() && <span className="text-gray-400">({getPhonePrefix()})</span>}
                      </label>
                      <input type="text"
                        value={currentBenef.celular}
                        onChange={e => setCurrentBenef(b => ({ ...b, celular: e.target.value.replace(/\D/g, '') }))}
                        placeholder="Solo dígitos"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Domicilio</label>
                      <input type="text"
                        value={currentBenef.domicilio}
                        onChange={e => setCurrentBenef(b => ({ ...b, domicilio: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Ciudad</label>
                      <input type="text"
                        value={currentBenef.ciudad}
                        onChange={e => setCurrentBenef(b => ({ ...b, ciudad: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500" />
                    </div>
                  </div>
                  {benError && <p className="text-sm text-red-600">{benError}</p>}
                  <div className="flex gap-3">
                    <button type="button" onClick={confirmBenef}
                      className="px-4 py-2 bg-primary-600 text-white text-sm rounded-md hover:bg-primary-700">
                      Confirmar beneficiario
                    </button>
                    <button type="button" onClick={cancelBenef}
                      className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-md hover:bg-gray-50">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {/* Botón agregar beneficiario */}
              {!addingBenef && (
                <button
                  type="button"
                  onClick={() => { setAddingBenef(true); setBenError('') }}
                  className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-primary-300 text-primary-600 rounded-lg hover:bg-primary-50 text-sm font-medium w-full justify-center"
                >
                  <PlusIcon className="w-4 h-4" />
                  Agregar beneficiario
                </button>
              )}
            </div>
          )}

          {/* ── PASO 8: Confirmación ─────────────────────────────────────── */}
          {step === 8 && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">Confirmación</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg p-4 space-y-1">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contrato</p>
                  <p className="font-bold text-gray-900 text-lg">{contrato}</p>
                  <p className="text-sm text-gray-600">Plataforma: {plataforma}</p>
                  <p className="text-sm text-gray-600">Asesor: {asesor}</p>
                </div>

                <div className="bg-gray-50 rounded-lg p-4 space-y-1">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Titular</p>
                  <p className="font-medium text-gray-900">{titular.primerNombre} {titular.segundoNombre} {titular.primerApellido} {titular.segundoApellido}</p>
                  <p className="text-sm text-gray-600">ID: {titular.numeroId}</p>
                  <p className="text-sm text-gray-600">{titular.email}</p>
                  <p className="text-sm text-gray-600">{titular.ciudad}, {titular.pais}</p>
                </div>

                <div className="bg-gray-50 rounded-lg p-4 space-y-1">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Financiero</p>
                  <p className="text-sm text-gray-700">Total plan: <strong>${fmt(financial.totalPlan)}</strong></p>
                  <p className="text-sm text-gray-700">Cuota inicial: ${fmt(financial.pagoInscripcion)}</p>
                  <p className="text-sm text-gray-700">Saldo: ${fmt(financial.saldo)} en {financial.numeroCuotas} cuota(s)</p>
                  <p className="text-sm text-gray-700">Vigencia: {financial.vigencia} mes(es) — {financial.medioPago}</p>
                  {financial.finalContrato && <p className="text-sm text-gray-700">Vence: {financial.finalContrato}</p>}
                </div>

                <div className="bg-gray-50 rounded-lg p-4 space-y-1">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Beneficiarios ({totalBenef})</p>
                  {titularEsBeneficiario && (
                    <p className="text-sm text-gray-700">• {titular.primerNombre} {titular.primerApellido} <span className="text-blue-600 text-xs">(Titular)</span></p>
                  )}
                  {beneficiarios.map((b, i) => (
                    <p key={i} className="text-sm text-gray-700">• {b.primerNombre} {b.primerApellido} — ID: {b.numeroId}</p>
                  ))}
                  {totalBenef === 0 && <p className="text-sm text-gray-500 italic">Sin beneficiarios</p>}
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                Al confirmar se crearán los registros en PEOPLE y FINANCIEROS. Esta acción no se puede deshacer desde esta pantalla.
              </div>
            </div>
          )}

          {/* ── Error global ─────────────────────────────────────────────── */}
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
              {error}
            </div>
          )}

          {/* ── Navegación ───────────────────────────────────────────────── */}
          <div className="mt-6 flex justify-between">
            <button
              type="button"
              onClick={handlePrev}
              disabled={step === 1}
              className="flex items-center gap-1 px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              <ArrowLeftIcon className="w-4 h-4" /> Anterior
            </button>

            {step < 8 ? (
              <button
                type="button"
                onClick={handleNext}
                className="flex items-center gap-1 px-5 py-2 bg-primary-600 text-white rounded-md text-sm font-medium hover:bg-primary-700"
              >
                Siguiente <ArrowRightIcon className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? 'Migrando...' : 'Confirmar y Migrar'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Modal "¿Agregar otro beneficiario?" ──────────────────────────── */}
      {showAnotherModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Beneficiario guardado</h3>
            <p className="text-gray-600 text-sm">¿Deseas agregar otro beneficiario?</p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => { setShowAnotherModal(false); setAddingBenef(true) }}
                className="px-4 py-2 bg-primary-600 text-white text-sm rounded-md hover:bg-primary-700"
              >
                Sí, agregar otro
              </button>
              <button
                type="button"
                onClick={() => setShowAnotherModal(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-md hover:bg-gray-50"
              >
                No, continuar
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}
