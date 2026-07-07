'use client'

/**
 * /admin/diagnostico — Mide tiempos de respuesta de endpoints clave de la API
 * desde el navegador del admin. Usa Resource Timing API + performance.now()
 * para separar DNS / Connect TCP / TLS / TTFB / Total — equivalente al
 * script `diagnose.sh` pero corriendo en cliente.
 *
 * Gateado por MANTENIMIENTO.DIAGNOSTICO.VER (SUPER_ADMIN/ADMIN bypass).
 */
import { useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { MantenimientoPermission } from '@/types/permissions'
import {
  PlayIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  ChartBarIcon,
} from '@heroicons/react/24/outline'

/**
 * Endpoints disponibles para medir. Cada uno define cómo construir la URL
 * final. Si requireId=true, se muestra el input de ID y se inyecta en el path.
 */
const ENDPOINTS = [
  {
    key: 'advisors',
    label: 'Guías (lista)',
    path: '/api/postgres/guias',
    requireId: false,
    helpText: 'Lista completa de advisors. Debería ser rápido (<300ms TTFB).',
  },
  {
    key: 'student',
    label: 'Student (detalle por ID)',
    path: '/api/postgres/students/{id}',
    requireId: true,
    idLabel: 'ID del estudiante (ACADEMICA._id)',
    idPlaceholder: 'acd_1779...',
    helpText: 'JOIN PEOPLE + ACADEMICA + niveles. Si demora >2s indica problema en lookups.',
  },
  {
    key: 'person',
    label: 'Person (detalle por ID)',
    path: '/api/postgres/people/{id}',
    requireId: true,
    idLabel: 'ID de la persona (PEOPLE._id)',
    idPlaceholder: 'prs_...',
    helpText: 'Lectura simple de PEOPLE. Debería ser muy rápido (<200ms TTFB).',
  },
  {
    key: 'users-by-role',
    label: 'Usuarios por rol (ADVISOR)',
    path: '/api/postgres/users/by-role?roles=ADVISOR&activeOnly=true',
    requireId: false,
    helpText: 'Usado por dropdowns de admin. Filtro simple sobre USUARIOS_ROLES.',
  },
  {
    key: 'dashboard-stats',
    label: 'Dashboard stats',
    path: '/api/postgres/dashboard/stats',
    requireId: false,
    helpText: '4 queries paralelas (Total/Inactivos/Sesiones/Inscritos/Advisors). Si >2s revisar índices.',
  },
  {
    key: 'dashboard-monthly',
    label: 'Dashboard monthly (heatmap)',
    path: '/api/postgres/dashboard/monthly?tz=America/Bogota',
    requireId: false,
    helpText: '3 queries paralelas pesadas (CALENDARIO JOIN ACADEMICA_BOOKINGS). Suele ser el más lento.',
  },
  {
    key: 'search',
    label: 'Search (q=test)',
    path: '/api/postgres/search?q=test',
    requireId: false,
    helpText: 'Búsqueda unificada en PEOPLE+ACADEMICA. Mide latencia de full-text search.',
  },
  {
    key: 'niveles',
    label: 'Niveles (lista completa)',
    path: '/api/postgres/niveles',
    requireId: false,
    helpText: 'Lectura simple de NIVELES (52 filas). Baseline de "mínima" latencia.',
  },
] as const

type EndpointKey = typeof ENDPOINTS[number]['key']

interface Sample {
  i: number
  dns: number
  tcp: number
  tls: number
  ttfb: number
  total: number
  status: number | null
  error?: string
}

interface Averages {
  dns: number
  tcp: number
  tls: number
  ttfb: number
  total: number
}

/** Mide UN request al endpoint con Resource Timing API. Devuelve los splits en ms. */
async function measureOne(url: string): Promise<Sample> {
  // marker único para encontrar la entrada en performance API
  const cacheBuster = `_diag=${Date.now()}_${Math.floor(Math.random() * 1e6)}`
  const finalUrl = url.includes('?') ? `${url}&${cacheBuster}` : `${url}?${cacheBuster}`

  performance.clearResourceTimings()
  const wallStart = performance.now()
  let status: number | null = null
  let errorMsg: string | undefined = undefined
  try {
    const res = await fetch(finalUrl, { cache: 'no-store', credentials: 'include' })
    status = res.status
    await res.text()           // consume body para que cuente el total real
  } catch (e: any) {
    errorMsg = e?.message || 'Fetch error'
  }
  const wallEnd = performance.now()

  // Busca la entrada de performance con la URL final (matching parcial)
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  const entry = entries.reverse().find(e => e.name.includes(cacheBuster))

  if (!entry) {
    // Fallback: si no encontramos la entrada (ocurre con bloqueadores), reportamos solo el total wall-clock
    return {
      i: 0,
      dns: 0, tcp: 0, tls: 0, ttfb: Math.round(wallEnd - wallStart), total: Math.round(wallEnd - wallStart),
      status, error: errorMsg,
    }
  }

  const dns  = Math.max(0, entry.domainLookupEnd - entry.domainLookupStart)
  const tcp  = Math.max(0, entry.connectEnd - entry.connectStart)
  const tls  = entry.secureConnectionStart > 0
    ? Math.max(0, entry.connectEnd - entry.secureConnectionStart)
    : 0
  const ttfb = Math.max(0, entry.responseStart - entry.requestStart)
  const total = Math.max(0, entry.responseEnd - entry.startTime)

  return {
    i: 0,
    dns:  Math.round(dns),
    tcp:  Math.round(tcp),
    tls:  Math.round(tls),
    ttfb: Math.round(ttfb),
    total: Math.round(total),
    status,
    error: errorMsg,
  }
}

function interpretTTFB(ms: number): { icon: 'ok' | 'warn' | 'bad'; text: string } {
  if (ms < 300)  return { icon: 'ok',   text: 'Excelente — el servidor responde rápido' }
  if (ms < 800)  return { icon: 'ok',   text: 'Bueno — dentro de lo esperado' }
  if (ms < 2000) return { icon: 'warn', text: 'Aceptable, pero conviene revisar' }
  return { icon: 'bad', text: 'Lento — el servidor está procesando demasiado tiempo' }
}

export default function DiagnosticoPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={MantenimientoPermission.DIAGNOSTICO} showDefaultMessage>
        <DiagnosticoContent />
      </PermissionGuard>
    </DashboardLayout>
  )
}

function DiagnosticoContent() {
  const [selectedEndpoint, setSelectedEndpoint] = useState<EndpointKey>('advisors')
  const [idParam, setIdParam] = useState('')
  const [samples, setSamples] = useState(5)
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<Sample[]>([])
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)

  const endpoint = ENDPOINTS.find(e => e.key === selectedEndpoint)!

  const buildUrl = (): string | null => {
    let url: string = endpoint.path
    if (endpoint.requireId) {
      const id = idParam.trim()
      if (!id) {
        setError(`Ingresa el ${('idLabel' in endpoint && endpoint.idLabel) || 'ID'}`)
        return null
      }
      url = url.replace('{id}', encodeURIComponent(id))
    }
    return url
  }

  async function runDiagnostic() {
    setError(null)
    setResults([])
    setProgress(0)

    const url = buildUrl()
    if (!url) return

    setRunning(true)
    const samplesList: Sample[] = []
    try {
      for (let i = 1; i <= samples; i++) {
        const m = await measureOne(url)
        m.i = i
        samplesList.push(m)
        setResults([...samplesList])
        setProgress(i)
        // Pequeña pausa entre muestras para no martillear
        if (i < samples) await new Promise(r => setTimeout(r, 400))
      }
    } catch (e: any) {
      setError(e?.message || 'Error inesperado')
    } finally {
      setRunning(false)
    }
  }

  const averages: Averages | null = results.length > 0
    ? {
        dns:  Math.round(results.reduce((a, b) => a + b.dns, 0)  / results.length),
        tcp:  Math.round(results.reduce((a, b) => a + b.tcp, 0)  / results.length),
        tls:  Math.round(results.reduce((a, b) => a + b.tls, 0)  / results.length),
        ttfb: Math.round(results.reduce((a, b) => a + b.ttfb, 0) / results.length),
        total:Math.round(results.reduce((a, b) => a + b.total, 0)/ results.length),
      }
    : null

  const interpretation = averages ? interpretTTFB(averages.ttfb) : null

  return (
    <div className="max-w-5xl mx-auto py-6 px-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <ChartBarIcon className="h-7 w-7 text-indigo-600" />
        <h1 className="text-2xl font-bold text-gray-900">Diagnóstico de Endpoints</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Mide tiempos de respuesta de endpoints clave (DNS / Connect TCP / TLS / TTFB / Total)
        desde tu navegador. Útil para detectar endpoints lentos o cuellos de botella en el servidor.
      </p>

      {/* Form */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label htmlFor="diag-endpoint" className="block text-xs font-medium text-gray-700 mb-1">
              Endpoint
            </label>
            <select
              id="diag-endpoint"
              value={selectedEndpoint}
              onChange={e => { setSelectedEndpoint(e.target.value as EndpointKey); setResults([]); setError(null) }}
              disabled={running}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              {ENDPOINTS.map(ep => (
                <option key={ep.key} value={ep.key}>{ep.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">{endpoint.helpText}</p>
          </div>
          <div>
            <label htmlFor="diag-samples" className="block text-xs font-medium text-gray-700 mb-1">
              Muestras
            </label>
            <select
              id="diag-samples"
              value={samples}
              onChange={e => setSamples(Number(e.target.value))}
              disabled={running}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              {[3, 5, 10, 20].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        {endpoint.requireId && (
          <div className="mt-4">
            <label htmlFor="diag-id" className="block text-xs font-medium text-gray-700 mb-1">
              {endpoint.idLabel || 'ID'} <span className="text-red-600">*</span>
            </label>
            <input
              id="diag-id"
              type="text"
              value={idParam}
              onChange={e => setIdParam(e.target.value)}
              disabled={running}
              placeholder={endpoint.idPlaceholder || ''}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>
        )}

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={runDiagnostic}
            disabled={running || (endpoint.requireId && !idParam.trim())}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            <PlayIcon className="h-4 w-4" />
            {running ? `Ejecutando ${progress}/${samples}…` : '🚀 Ejecutar diagnóstico'}
          </button>
          {results.length > 0 && (
            <button
              type="button"
              onClick={() => { setResults([]); setError(null) }}
              disabled={running}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Limpiar
            </button>
          )}
        </div>

        {error && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded p-2.5 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* Resultados */}
      {results.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-5">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-800">Resultados — todos los tiempos en milisegundos</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
                <th className="text-right py-2 px-3 w-10">#</th>
                <th className="text-right py-2 px-3 w-16">DNS</th>
                <th className="text-right py-2 px-3 w-16">TCP</th>
                <th className="text-right py-2 px-3 w-16">TLS</th>
                <th className="text-right py-2 px-3 w-20">TTFB</th>
                <th className="text-right py-2 px-3 w-20">Total</th>
                <th className="text-right py-2 px-3 w-16">HTTP</th>
              </tr>
            </thead>
            <tbody>
              {results.map(r => (
                <tr key={r.i} className="border-b border-gray-50 last:border-0">
                  <td className="text-right py-2 px-3 font-mono text-gray-500">{r.i}</td>
                  <td className="text-right py-2 px-3 font-mono">{r.dns}</td>
                  <td className="text-right py-2 px-3 font-mono">{r.tcp}</td>
                  <td className="text-right py-2 px-3 font-mono">{r.tls}</td>
                  <td className="text-right py-2 px-3 font-mono font-bold">{r.ttfb}</td>
                  <td className="text-right py-2 px-3 font-mono">{r.total}</td>
                  <td className="text-right py-2 px-3">
                    {r.status == null ? (
                      <span className="text-red-600 text-xs">err</span>
                    ) : r.status >= 200 && r.status < 400 ? (
                      <span className="text-emerald-700 font-medium">{r.status}</span>
                    ) : (
                      <span className="text-red-700 font-medium">{r.status}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {averages && (
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-indigo-50 font-bold">
                  <td className="text-right py-2 px-3 text-indigo-900">avg</td>
                  <td className="text-right py-2 px-3 font-mono text-indigo-900">{averages.dns}</td>
                  <td className="text-right py-2 px-3 font-mono text-indigo-900">{averages.tcp}</td>
                  <td className="text-right py-2 px-3 font-mono text-indigo-900">{averages.tls}</td>
                  <td className="text-right py-2 px-3 font-mono text-indigo-900">{averages.ttfb}</td>
                  <td className="text-right py-2 px-3 font-mono text-indigo-900">{averages.total}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Interpretación */}
      {averages && interpretation && (
        <div className={`rounded-xl border-l-4 p-4 ${
          interpretation.icon === 'ok'
            ? 'bg-emerald-50 border-emerald-500'
            : interpretation.icon === 'warn'
              ? 'bg-amber-50 border-amber-500'
              : 'bg-red-50 border-red-500'
        }`}>
          <div className="flex items-start gap-3">
            {interpretation.icon === 'ok' && <CheckCircleIcon className="h-6 w-6 text-emerald-600 flex-shrink-0" />}
            {interpretation.icon === 'warn' && <ExclamationTriangleIcon className="h-6 w-6 text-amber-600 flex-shrink-0" />}
            {interpretation.icon === 'bad' && <XCircleIcon className="h-6 w-6 text-red-600 flex-shrink-0" />}
            <div className="text-sm">
              <p className={`font-semibold mb-1 ${
                interpretation.icon === 'ok' ? 'text-emerald-900'
                  : interpretation.icon === 'warn' ? 'text-amber-900'
                  : 'text-red-900'
              }`}>
                {interpretation.text} — TTFB promedio: {averages.ttfb}ms
              </p>
              <div className="text-xs text-gray-700 space-y-0.5">
                <p>• <strong>DNS / TCP / TLS</strong> dependen de la red (Cloudflare + tu conexión). Si son altos, el problema es de red, no del servidor.</p>
                <p>• <strong>TTFB</strong> = tiempo de procesamiento del servidor (queries SQL + lógica de negocio). Si es alto, optimizar queries.</p>
                <p>• <strong>Total</strong> = TTFB + tiempo de descarga del response. Si es muy mayor a TTFB, response muy grande.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
