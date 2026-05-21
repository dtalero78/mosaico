'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import {
  ArrowLeftIcon,
  MagnifyingGlassIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  CheckCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { MantenimientoPermission } from '@/types/permissions'

type Step = 'idle' | 'searching' | 'invalid' | 'ready' | 'confirming' | 'executing' | 'done'

interface PersonToBlock {
  _id: string
  nombre: string
  numeroId: string | null
  finalContrato: string | null
  role: 'TITULAR' | 'BENEFICIARIO'
  reason: 'titular_expired' | 'matches_titular' | 'own_expired' | 'already_blocked'
}

interface PersonToSkip {
  _id: string
  nombre: string
  numeroId: string | null
  finalContrato: string | null
  role: 'BENEFICIARIO'
  reason: 'extension_active'
}

interface LookupValid {
  valid: true
  contrato: string
  titular: { _id: string; nombre: string; numeroId: string | null; finalContrato: string | null; estadoInactivo: boolean }
  toBlock: PersonToBlock[]
  toSkip: PersonToSkip[]
}
interface LookupInvalid {
  valid: false
  reason: 'titular_no_vencido' | 'sin_finalcontrato'
  message: string
  titular: { _id: string; nombre: string; numeroId: string | null; finalContrato: string | null }
}
type Lookup = LookupValid | LookupInvalid

interface ExecuteResult {
  blocked: number
  details: Array<{ _id: string; nombre: string; success: boolean; error?: string }>
}

export default function BloqueoContratoPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={MantenimientoPermission.BLOQUEAR_CONTRATO} showDefaultMessage>
        <BloqueoContratoContent />
      </PermissionGuard>
    </DashboardLayout>
  )
}

function BloqueoContratoContent() {
  const [contrato, setContrato] = useState('')
  const [step, setStep] = useState<Step>('idle')
  const [lookup, setLookup] = useState<Lookup | null>(null)
  const [result, setResult] = useState<ExecuteResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function reset() {
    setContrato('')
    setStep('idle')
    setLookup(null)
    setResult(null)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  async function handleSearch() {
    const value = contrato.trim()
    if (!value) {
      toast.error('Ingresa un número de contrato')
      return
    }
    setStep('searching')
    try {
      const res = await fetch('/api/admin/bloqueo-contrato/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contrato: value }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data?.error || 'Error al buscar el contrato')
        setStep('idle')
        return
      }
      const payload: Lookup = data?.data ?? data
      setLookup(payload)
      setStep(payload.valid ? 'ready' : 'invalid')
    } catch (e) {
      toast.error('Error de red. Intenta de nuevo.')
      setStep('idle')
    }
  }

  async function handleExecute() {
    if (!lookup || !lookup.valid) return
    setStep('executing')
    try {
      const res = await fetch('/api/admin/bloqueo-contrato/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personIds: lookup.toBlock.map(p => p._id) }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data?.error || 'Error al ejecutar el bloqueo')
        setStep('confirming')
        return
      }
      const payload: ExecuteResult = data?.data ?? data
      setResult(payload)
      setStep('done')
    } catch (e) {
      toast.error('Error de red al ejecutar.')
      setStep('confirming')
    }
  }

  const reasonLabel = (r: PersonToBlock['reason']) => {
    switch (r) {
      case 'titular_expired':   return 'Titular vencido'
      case 'matches_titular':   return 'Fecha coincide con titular'
      case 'own_expired':       return 'Extensión vencida'
      case 'already_blocked':   return 'Ya estaba bloqueado'
      default:                  return r
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeftIcon className="h-4 w-4 mr-1" /> Volver
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <LockClosedIcon className="h-6 w-6 text-red-600" />
          Bloqueo Contrato
        </h1>
      </div>

      <p className="text-sm text-gray-600">
        Bloquea manualmente titular y beneficiarios de un contrato vencido.
        Respeta extensiones individuales: beneficiarios con <code className="text-xs bg-gray-100 px-1 rounded">finalContrato</code> mayor a hoy <strong>no</strong> se bloquean.
      </p>

      {/* Input + search */}
      {(step === 'idle' || step === 'searching') && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
          <label htmlFor="contrato" className="block text-sm font-medium text-gray-700">
            Número de contrato
          </label>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              id="contrato"
              type="text"
              value={contrato}
              onChange={e => setContrato(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
              placeholder="Ej. 02-10477-26"
              disabled={step === 'searching'}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm disabled:bg-gray-50"
            />
            <button
              type="button"
              onClick={handleSearch}
              disabled={step === 'searching' || !contrato.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              <MagnifyingGlassIcon className="h-4 w-4" />
              {step === 'searching' ? 'Buscando…' : 'Buscar'}
            </button>
          </div>
        </div>
      )}

      {/* Modal de inconsistencia (titular no vencido) */}
      {step === 'invalid' && lookup && !lookup.valid && (
        <div className="bg-amber-50 border-l-4 border-amber-500 rounded-lg p-6 space-y-4">
          <div className="flex items-start gap-3">
            <ExclamationTriangleIcon className="h-6 w-6 text-amber-600 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="text-base font-semibold text-amber-900">Inconsistencia de fechas</h3>
              <p className="text-sm text-amber-900 mt-1">{lookup.message}</p>
              <div className="mt-3 text-xs text-amber-900 bg-amber-100 rounded p-2">
                <div><strong>Titular:</strong> {lookup.titular.nombre}</div>
                {lookup.titular.numeroId && <div><strong>ID:</strong> {lookup.titular.numeroId}</div>}
                <div><strong>Final Contrato:</strong> {lookup.titular.finalContrato || '(no registrado)'}</div>
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={reset}
              className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700"
            >
              OK, entendido
            </button>
          </div>
        </div>
      )}

      {/* Vista previa: qué se va a bloquear y qué se va a saltar */}
      {(step === 'ready' || step === 'confirming' || step === 'executing') && lookup && lookup.valid && (
        <div className="space-y-4">
          {/* Info titular */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-700">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span><strong>Contrato:</strong> {lookup.contrato}</span>
              <span><strong>Titular:</strong> {lookup.titular.nombre}</span>
              {lookup.titular.numeroId && <span><strong>ID:</strong> {lookup.titular.numeroId}</span>}
              <span><strong>Final Contrato:</strong> {lookup.titular.finalContrato} (vencido ✓)</span>
            </div>
          </div>

          {/* Bloque a bloquear */}
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-red-900 mb-2 flex items-center gap-2">
              <LockClosedIcon className="h-4 w-4" />
              Se bloquearán ({lookup.toBlock.length})
            </h3>
            {lookup.toBlock.length === 0 ? (
              <p className="text-sm text-red-900">Ninguna persona a bloquear.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {lookup.toBlock.map(p => (
                  <li key={p._id} className="flex flex-wrap items-center gap-x-2 text-red-900">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-200 text-red-900 uppercase">
                      {p.role}
                    </span>
                    <strong>{p.nombre}</strong>
                    {p.numeroId && <span className="text-xs text-red-700">· ID {p.numeroId}</span>}
                    <span className="text-xs text-red-700">· vence {p.finalContrato || '(sin fecha)'}</span>
                    <span className="text-xs italic text-red-700">· {reasonLabel(p.reason)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Bloque a saltar */}
          {lookup.toSkip.length > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-emerald-900 mb-2 flex items-center gap-2">
                <CheckCircleIcon className="h-4 w-4" />
                NO se bloquearán — extensión vigente ({lookup.toSkip.length})
              </h3>
              <ul className="space-y-1.5 text-sm">
                {lookup.toSkip.map(p => (
                  <li key={p._id} className="flex flex-wrap items-center gap-x-2 text-emerald-900">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-200 text-emerald-900 uppercase">
                      {p.role}
                    </span>
                    <strong>{p.nombre}</strong>
                    {p.numeroId && <span className="text-xs text-emerald-700">· ID {p.numeroId}</span>}
                    <span className="text-xs text-emerald-700">· vence {p.finalContrato} (futuro)</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Botonera */}
          {step === 'ready' && (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={reset}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => setStep('confirming')}
                disabled={lookup.toBlock.length === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                Continuar
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modal de confirmación */}
      {step === 'confirming' && lookup && lookup.valid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <ExclamationTriangleIcon className="h-6 w-6 text-red-600 flex-shrink-0" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Confirmar bloqueo</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Se bloquearán <strong>{lookup.toBlock.length}</strong> personas del contrato <strong>{lookup.contrato}</strong>.
                  Esta acción actualiza <code className="text-xs bg-gray-100 px-1 rounded">PEOPLE</code>, <code className="text-xs bg-gray-100 px-1 rounded">ACADEMICA</code> y <code className="text-xs bg-gray-100 px-1 rounded">USUARIOS_ROLES</code> (bloquea login).
                </p>
                <p className="text-sm text-red-700 mt-2 font-medium">
                  ¿Estás seguro de continuar?
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStep('ready')}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                <XMarkIcon className="h-4 w-4 inline mr-1" /> Cancelar
              </button>
              <button
                type="button"
                onClick={handleExecute}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
              >
                Sí, bloquear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Estado: ejecutando */}
      {step === 'executing' && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 text-center">
          <div className="inline-flex items-center gap-2 text-gray-600">
            <svg className="animate-spin h-5 w-5 text-blue-600" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span className="text-sm">Aplicando bloqueo…</span>
          </div>
        </div>
      )}

      {/* Resultado final */}
      {step === 'done' && result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6 space-y-3">
          <div className="flex items-start gap-3">
            <CheckCircleIcon className="h-6 w-6 text-emerald-600 flex-shrink-0" />
            <div>
              <h3 className="text-base font-semibold text-emerald-900">Bloqueo completado</h3>
              <p className="text-sm text-emerald-900 mt-1">
                {result.blocked} persona(s) bloqueada(s) exitosamente.
              </p>
            </div>
          </div>
          <ul className="text-sm space-y-1 ml-9">
            {result.details.map(d => (
              <li key={d._id} className={d.success ? 'text-emerald-900' : 'text-red-700'}>
                {d.success ? '✅' : '❌'} {d.nombre}
                {d.error && <span className="text-xs"> — {d.error}</span>}
              </li>
            ))}
          </ul>
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={reset}
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-md hover:bg-emerald-700"
            >
              Bloquear otro contrato
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
