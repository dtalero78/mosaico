'use client'

import { useCallback, useEffect, useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { MantenimientoPermission } from '@/types/permissions'

interface Canal {
  conectado: boolean
  estado: string
  numero: string | null
  verificadoEn: string
  latenciaMs: number
}

const AUTO_REFRESH_MS = 60_000

function Content() {
  const [canal, setCanal] = useState<Canal | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/contingencia/whatsapp', { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error || 'Error consultando el estado'); return }
      setCanal(j.canal)
      setError(null)
    } catch {
      setError('Error consultando el estado')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, AUTO_REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  const ok = canal?.conectado === true

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-900">Canal de WhatsApp</h1>
        <button
          onClick={load}
          disabled={loading}
          className="text-sm px-3 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
        >
          ↻ Refrescar
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Estado en vivo de la línea por la que salen todos los mensajes (OTP de firma, contratos, bienvenida,
        informes, mensajería masiva). Se actualiza solo cada minuto.
      </p>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!canal && loading ? (
        <p className="text-gray-500">Consultando…</p>
      ) : canal && (
        <div className={`rounded-lg border-2 p-5 ${ok ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'}`}>
          <div className="flex items-center gap-3">
            <span className={`inline-block h-4 w-4 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500 animate-pulse'}`} />
            <div className={`text-xl font-bold ${ok ? 'text-emerald-800' : 'text-red-700'}`}>
              {ok ? 'Conectado' : 'Canal caído'}
            </div>
            <span className="ml-auto text-xs font-mono text-gray-500">{canal.estado}</span>
          </div>

          <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-400">Línea</dt>
              <dd className="font-medium text-gray-900">{canal.numero ? `+${canal.numero}` : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-400">Respuesta</dt>
              <dd className="font-medium text-gray-900">{canal.latenciaMs} ms</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-400">Verificado</dt>
              <dd className="font-medium text-gray-900">{new Date(canal.verificadoEn).toLocaleTimeString()}</dd>
            </div>
          </dl>

          {!ok && (
            <div className="mt-4 rounded-md bg-white/70 border border-red-200 p-3 text-sm text-gray-700">
              <b>Qué hacer:</b>
              <ol className="list-decimal ml-5 mt-1 space-y-0.5">
                <li>Estado <b>QR</b>: la sesión se cerró. Abra WhatsApp en el celular de la línea y, si lo pide, reescanee el QR en el panel de Whapi.</li>
                <li>Estado <b>ERROR</b>/<b>HTTP</b>: Whapi no responde o el token es inválido; revise <code>WHAPI_TOKEN</code>.</li>
                <li>Mientras tanto, los mensajes no salen: use la opción <b>Link de sesión</b> o avise a las familias por otro medio.</li>
              </ol>
            </div>
          )}
        </div>
      )}

      <p className="mt-5 text-xs text-gray-400">
        La línea debe abrirse en el celular al menos una vez cada 14 días o Whapi cierra la sesión. Esta pantalla nunca muestra el token.
      </p>
    </div>
  )
}

export default function Page() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={MantenimientoPermission.CONTINGENCIA_WHATSAPP} showDefaultMessage>
        <Content />
      </PermissionGuard>
    </DashboardLayout>
  )
}
