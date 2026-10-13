'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { PermissionGuard } from '@/components/permissions'
import AgendarWelcomeModal from '@/components/servicio/AgendarWelcomeModal'
import { ServicioPermission } from '@/types/permissions'
import { formatDateTime } from '@/lib/utils'
import { exportToExcel } from '@/lib/export-excel'
import { ESTADO_CURSO_META, type CampanaEstado } from '@/lib/cursos-campaign'
import { coincidePersona } from '@/lib/busqueda-persona'
import { etiquetaMotivoWelcomePendiente, MOTIVO_WELCOME_PENDIENTE_LABEL } from '@/lib/welcome-pendiente'

const CAMPANA_ACTUALES = '__actuales__'
const CAMPANA_TODAS = '__todas__'
const MOTIVO_TODOS = '__todos__'
const MOTIVO_SIN = '__sin__'

interface Props {
  estadosCampana: CampanaEstado[]
  actuales: string[]
}

/** Alumno con perfil creado y sin ninguna bienvenida agendada. */
interface Pendiente {
  academicaId: string
  primerNombre: string
  primerApellido: string
  numeroId: string
  contrato: string
  celular: string
  campaign: string
  tipoCurso: string
  apoderado: string
  apoderadoTelefono: string
  /** Por qué quedó sin agendar (null = perfil anterior a que se registrara). */
  motivo: string | null
  pendienteDesde: string | null
}

const nombreDe = (r: Pendiente) => `${r.primerNombre} ${r.primerApellido}`.trim() || '(sin nombre)'

/** El que el alumno pidió va destacado: es el que espera que lo llamen. */
const MOTIVO_BADGE: Record<string, string> = {
  SOLICITUD_USUARIO: 'bg-purple-100 text-purple-800',
  SOLO_PERFIL: 'bg-blue-100 text-blue-800',
  SIN_SESIONES: 'bg-amber-100 text-amber-800',
  NO_AGENDADO: 'bg-red-100 text-red-800',
}

/**
 * "Pendientes de agendar": alumnos que crearon su perfil sin agendar la
 * bienvenida (la pidieron coordinar con Servicio, entraron por el enlace de sólo
 * perfil o no había sesiones). La lista se calcula en el servidor; al agendarles
 * una sesión salen solos.
 */
export default function WelcomePendientesAgendarTab({ estadosCampana, actuales }: Props) {
  const [rows, setRows] = useState<Pendiente[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [buscar, setBuscar] = useState('')
  // Es una cola de trabajo: abre con TODAS las campañas para no esconder a nadie
  // que siga esperando su bienvenida desde una campaña anterior.
  const [campanaFiltro, setCampanaFiltro] = useState<string>(CAMPANA_TODAS)
  const [motivoFiltro, setMotivoFiltro] = useState<string>(MOTIVO_TODOS)
  const [target, setTarget] = useState<Pendiente | null>(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/postgres/events/welcome?mode=pendientes')
      if (!res.ok) throw new Error(`Error ${res.status}: ${res.statusText}`)
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Error al cargar')
      setRows(data.events || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const campanasEnDatos = useMemo(() => {
    const set = new Set(rows.map((r) => (r.campaign || '').trim()).filter(Boolean))
    const orden = new Map(estadosCampana.map((c) => [c.campaign, c.inicio || '']))
    return Array.from(set).sort((a, b) => String(orden.get(b) || '').localeCompare(String(orden.get(a) || '')))
  }, [rows, estadosCampana])

  const filtradas = useMemo(() => rows.filter((r) => {
    if (campanaFiltro !== CAMPANA_TODAS) {
      const c = (r.campaign || '').trim()
      if (campanaFiltro === CAMPANA_ACTUALES) {
        if (actuales.length > 0 && !actuales.includes(c)) return false
      } else if (c !== campanaFiltro) return false
    }
    if (motivoFiltro === MOTIVO_SIN && r.motivo) return false
    if (motivoFiltro !== MOTIVO_TODOS && motivoFiltro !== MOTIVO_SIN && r.motivo !== motivoFiltro) return false
    return coincidePersona({ nombre: nombreDe(r), numeroId: r.numeroId, contrato: r.contrato }, buscar)
  }), [rows, campanaFiltro, actuales, motivoFiltro, buscar])

  return (
    <div className="card">
      <div className="card-content">
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 items-end">
            <div>
              <label htmlFor="penCampana" className="block text-sm font-medium text-gray-700 mb-1">Campaña</label>
              <select
                id="penCampana"
                value={campanaFiltro}
                onChange={(e) => setCampanaFiltro(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                <option value={CAMPANA_TODAS}>Todas</option>
                <option value={CAMPANA_ACTUALES}>
                  Actuales{actuales.length ? ` (${actuales.join(' + ')})` : ''}
                </option>
                {campanasEnDatos.map((c) => {
                  const est = estadosCampana.find((e) => e.campaign === c)
                  return (
                    <option key={c} value={c}>
                      {c}{est ? ` — ${ESTADO_CURSO_META[est.estado].label}` : ''}
                    </option>
                  )
                })}
              </select>
            </div>
            <div>
              <label htmlFor="penMotivo" className="block text-sm font-medium text-gray-700 mb-1">Motivo</label>
              <select
                id="penMotivo"
                value={motivoFiltro}
                onChange={(e) => setMotivoFiltro(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                <option value={MOTIVO_TODOS}>Todos</option>
                {Object.entries(MOTIVO_WELCOME_PENDIENTE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
                <option value={MOTIVO_SIN}>Sin registro de motivo</option>
              </select>
            </div>
            <div className="lg:col-span-2">
              <label htmlFor="penBuscar" className="block text-sm font-medium text-gray-700 mb-1">Nombre, ID o contrato</label>
              <input
                type="text"
                id="penBuscar"
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
                placeholder="Nombre, documento o contrato..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setBuscar(''); setCampanaFiltro(CAMPANA_TODAS); setMotivoFiltro(MOTIVO_TODOS) }}
                className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
              >
                Limpiar
              </button>
              <button
                onClick={() => exportToExcel(filtradas, [
                  { header: 'Nombre', accessor: (r) => nombreDe(r) },
                  { header: 'ID', accessor: (r) => r.numeroId || '' },
                  { header: 'Contrato', accessor: (r) => r.contrato || '' },
                  { header: 'Celular', accessor: (r) => r.celular || '' },
                  { header: 'Apoderado', accessor: (r) => r.apoderado || '' },
                  { header: 'Teléfono apoderado', accessor: (r) => r.apoderadoTelefono || '' },
                  { header: 'Campaña', accessor: (r) => r.campaign || '' },
                  { header: 'Curso', accessor: (r) => r.tipoCurso || '' },
                  { header: 'Motivo', accessor: (r) => etiquetaMotivoWelcomePendiente(r.motivo) },
                  { header: 'Pendiente desde', accessor: (r) => (r.pendienteDesde ? formatDateTime(r.pendienteDesde) : '') },
                ], `welcome-pendientes-agendar-${new Date().toISOString().split('T')[0]}`)}
                disabled={filtradas.length === 0}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Excel
              </button>
            </div>
          </div>
          <div className="mt-3 text-sm text-gray-600">
            {loading ? 'Cargando…' : `Mostrando ${filtradas.length} de ${rows.length} alumno(s) pendiente(s) de agendar`}
          </div>
        </div>

        {error ? (
          <div className="alert alert-error">
            <div className="ml-3 text-sm text-red-700">{error}</div>
          </div>
        ) : filtradas.length === 0 && !loading ? (
          <div className="text-center py-10 text-gray-500">
            <h3 className="text-sm font-medium text-gray-900">No hay bienvenidas pendientes de agendar</h3>
            <p className="mt-1 text-sm">
              {rows.length > 0
                ? 'Nadie coincide con esos filtros.'
                : 'Todos los alumnos que crearon su perfil tienen una bienvenida agendada.'}
            </p>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead className="table-header">
                <tr>
                  <th className="table-header-cell">Alumno</th>
                  <th className="table-header-cell">ID</th>
                  <th className="table-header-cell">Contacto</th>
                  <th className="table-header-cell">Campaña · Curso</th>
                  <th className="table-header-cell">Motivo</th>
                  <th className="table-header-cell">Pendiente desde</th>
                  <th className="table-header-cell text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="table-body">
                {filtradas.map((r) => (
                  <tr key={r.academicaId} className="hover:bg-gray-50">
                    <td className="table-cell">
                      <a
                        href={`/student/${r.academicaId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-blue-600 hover:underline"
                      >
                        {nombreDe(r)}
                      </a>
                    </td>
                    <td className="table-cell text-sm text-gray-500">
                      <div>{r.numeroId || '—'}</div>
                      {r.contrato ? <div className="text-xs text-gray-400">{r.contrato}</div> : null}
                    </td>
                    <td className="table-cell text-sm text-gray-500">
                      <div>{r.celular || '—'}</div>
                      {r.apoderado || r.apoderadoTelefono ? (
                        <div className="text-xs text-gray-400" title="Apoderado">
                          Apod.: {r.apoderado || '—'}{r.apoderadoTelefono ? ` · ${r.apoderadoTelefono}` : ''}
                        </div>
                      ) : null}
                    </td>
                    <td className="table-cell text-sm text-gray-500">
                      <div>{r.campaign || '—'}</div>
                      <div className="text-xs text-gray-400">{r.tipoCurso || '—'}</div>
                    </td>
                    <td className="table-cell">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${MOTIVO_BADGE[r.motivo || ''] || 'bg-gray-100 text-gray-600'}`}>
                        {etiquetaMotivoWelcomePendiente(r.motivo)}
                      </span>
                    </td>
                    <td className="table-cell text-sm text-gray-500">
                      {r.pendienteDesde ? formatDateTime(r.pendienteDesde) : '—'}
                    </td>
                    <td className="table-cell text-right">
                      <PermissionGuard permission={ServicioPermission.WELCOME_REAGENDAR}>
                        <button
                          onClick={() => setTarget(r)}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md"
                        >
                          Agendar
                        </button>
                      </PermissionGuard>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {target && (
        <AgendarWelcomeModal
          studentId={target.academicaId}
          nombre={nombreDe(target)}
          tipoCurso={target.tipoCurso}
          titulo="Agendar sesión de bienvenida"
          accion="Agendar"
          aviso="El alumno todavía no tiene ninguna bienvenida agendada. Al agendarle una sesión sale de esta lista."
          onClose={() => setTarget(null)}
          onAgendado={() => { setTarget(null); cargar() }}
        />
      )}
    </div>
  )
}
