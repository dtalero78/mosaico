'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { ComercialPermission } from '@/types/permissions'
import { addMonths, campaignNameToDate, hoyEnChile } from '@/lib/cursos-campaign'
import { exportToExcel } from '@/lib/export-excel'
import { ArrowDownTrayIcon, CalendarDaysIcon } from '@heroicons/react/24/outline'

interface Fila {
  _id: string
  numeroId: string | null
  contrato: string | null
  nombre: string
  email: string | null
  celular: string | null
  asesor: string | null
  finalContrato: string
  diasRestantes: number
  modulo: boolean
  campanias: string | null
  cursos: string | null
}

interface Filtros {
  campaign: string
  curso: string
  asesor: string
  desde: string
  hasta: string
}

/** Por defecto: lo que vence de hoy a un mes. */
function filtrosPorDefecto(): Filtros {
  const hoy = hoyEnChile()
  return { campaign: '', curso: '', asesor: '', desde: hoy, hasta: addMonths(hoy, 1) }
}

const fmtFecha = (iso: string) => {
  if (!iso) return '—'
  // Fecha pura: se lee en UTC para que no se corra un día en Chile o Colombia.
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('es-CL', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

function diasCls(d: number) {
  if (d <= 7) return 'bg-red-100 text-red-700'
  if (d <= 15) return 'bg-amber-100 text-amber-800'
  return 'bg-gray-100 text-gray-700'
}

export default function VencimientosPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={ComercialPermission.VENCIMIENTOS} showDefaultMessage>
        <VencimientosContent />
      </PermissionGuard>
    </DashboardLayout>
  )
}

function VencimientosContent() {
  const [borrador, setBorrador] = useState<Filtros>(filtrosPorDefecto)
  const [rows, setRows] = useState<Fila[]>([])
  const [opciones, setOpciones] = useState<{ campanias: string[]; cursos: string[]; asesores: string[] }>({
    campanias: [], cursos: [], asesores: [],
  })
  const [capped, setCapped] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const reqRef = useRef(0)

  const cargar = useCallback(async (f: Filtros) => {
    const id = ++reqRef.current
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams()
      Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const res = await fetch(`/api/postgres/comercial/vencimientos?${qs}`, { cache: 'no-store' })
      const json = await res.json()
      if (id !== reqRef.current) return
      if (!res.ok || json.success === false) throw new Error(json.error || 'No se pudo cargar la consulta')
      setRows(json.rows || [])
      setCapped(!!json.capped)
      setOpciones(json.opciones || { campanias: [], cursos: [], asesores: [] })
    } catch (e: any) {
      if (id === reqRef.current) { setError(e.message); setRows([]) }
    } finally {
      if (id === reqRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => { cargar(filtrosPorDefecto()) }, [cargar])

  // Campañas de la más reciente a la más antigua (el nombre lleva su fecha).
  const campanias = useMemo(
    () => [...opciones.campanias].sort((a, b) =>
      (campaignNameToDate(b) || '').localeCompare(campaignNameToDate(a) || '')),
    [opciones.campanias],
  )

  const totalModulo = rows.filter(r => r.modulo).length

  const aplicar = () => cargar(borrador)
  const limpiar = () => { const f = filtrosPorDefecto(); setBorrador(f); cargar(f) }

  const descargar = () => {
    exportToExcel<Fila>(
      rows,
      [
        { header: 'Titular', accessor: r => r.nombre },
        { header: 'ID', accessor: r => r.numeroId },
        { header: 'Contrato', accessor: r => r.contrato },
        { header: 'Correo', accessor: r => r.email },
        { header: 'Teléfono', accessor: r => r.celular },
        { header: 'Módulo', accessor: r => (r.modulo ? 'Sí' : 'No') },
        { header: 'Campaña', accessor: r => r.campanias },
        { header: 'Curso', accessor: r => r.cursos },
        { header: 'Asesor comercial', accessor: r => r.asesor },
        { header: 'Vence', accessor: r => r.finalContrato },
        { header: 'Días restantes', accessor: r => r.diasRestantes },
      ],
      `vencimientos_${borrador.desde}_${borrador.hasta}`,
    )
  }

  const input = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'
  const label = 'mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <CalendarDaysIcon className="h-7 w-7 text-primary-600" />
            Vencimientos
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Contratos aprobados que vencen en el rango elegido. Por defecto, los que vencen de hoy a un mes.
          </p>
        </div>
        <button
          type="button"
          onClick={descargar}
          disabled={rows.length === 0}
          className="inline-flex items-center gap-2 rounded-md bg-green-100 px-4 py-2 text-sm font-medium text-green-800 hover:bg-green-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowDownTrayIcon className="h-4 w-4" />
          Descargar CSV
        </button>
      </div>

      {/* Filtros */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className={label} htmlFor="f-campana">Campaña</label>
            <select id="f-campana" className={input} value={borrador.campaign}
              onChange={e => setBorrador({ ...borrador, campaign: e.target.value })}>
              <option value="">Todas</option>
              {campanias.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="f-curso">Curso</label>
            <select id="f-curso" className={input} value={borrador.curso}
              onChange={e => setBorrador({ ...borrador, curso: e.target.value })}>
              <option value="">Todos</option>
              {opciones.cursos.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="f-asesor">Asesor comercial</label>
            <select id="f-asesor" className={input} value={borrador.asesor}
              onChange={e => setBorrador({ ...borrador, asesor: e.target.value })}>
              <option value="">Todos</option>
              {opciones.asesores.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="f-desde">Vence desde</label>
            <input id="f-desde" type="date" className={input} value={borrador.desde}
              onChange={e => setBorrador({ ...borrador, desde: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor="f-hasta">Vence hasta</label>
            <input id="f-hasta" type="date" className={input} value={borrador.hasta}
              onChange={e => setBorrador({ ...borrador, hasta: e.target.value })} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={aplicar}
            className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
            Aplicar filtros
          </button>
          <button type="button" onClick={limpiar}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Limpiar filtros
          </button>
        </div>
      </div>

      {/* Resumen */}
      <div className="flex flex-wrap gap-3 text-sm">
        <span className="rounded-full bg-primary-50 px-3 py-1 font-medium text-primary-800">
          {loading ? 'Cargando…' : `${rows.length} contrato(s) por vencer`}
        </span>
        {!loading && (
          <span className="rounded-full bg-accent-50 px-3 py-1 font-medium text-accent-800">
            {totalModulo} módulo(s)
          </span>
        )}
        {capped && (
          <span className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-800">
            Se muestran los primeros {rows.length}; acota el rango
          </span>
        )}
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Tabla */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3">Titular</th>
              <th className="px-4 py-3">Contrato</th>
              <th className="px-4 py-3">Correo</th>
              <th className="px-4 py-3">Teléfono</th>
              <th className="px-4 py-3 text-center">Módulo</th>
              <th className="px-4 py-3">Campaña · Curso</th>
              <th className="px-4 py-3">Asesor comercial</th>
              <th className="px-4 py-3">Vence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-500">
                  No hay contratos que venzan en este rango.
                </td>
              </tr>
            )}
            {rows.map(r => (
              <tr key={r._id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <a href={`/person/${r._id}`} target="_blank" rel="noopener noreferrer"
                    className="font-medium text-primary-700 hover:underline">
                    {r.nombre || '—'}
                  </a>
                  {r.numeroId && <div className="text-xs text-gray-500">{r.numeroId}</div>}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-700">{r.contrato || '—'}</td>
                <td className="px-4 py-3 text-gray-700">{r.email || '—'}</td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-gray-700">{r.celular || '—'}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    r.modulo ? 'bg-primary-100 text-primary-800' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {r.modulo ? 'Sí' : 'No'}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-700">
                  <div className="text-xs">{r.campanias || '—'}</div>
                  <div className="text-xs font-semibold text-gray-900">{r.cursos || ''}</div>
                </td>
                <td className="px-4 py-3 text-gray-700">{r.asesor || '—'}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="tabular-nums text-gray-900">{fmtFecha(r.finalContrato)}</div>
                  <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${diasCls(r.diasRestantes)}`}>
                    {r.diasRestantes === 0 ? 'vence hoy' : `${r.diasRestantes} día(s)`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
