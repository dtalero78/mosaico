'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { AcademicoPermission } from '@/types/permissions'
import { TIPOS_CURSO } from '@/lib/cursos-campaign'
import { useTiposCurso } from '@/hooks/use-tipos-curso'

/**
 * Académico › Horarios — catálogo de horarios que se ofrecen al crear un curso
 * de campaña.
 *
 * Quitar un horario lo DESACTIVA: deja de ofrecerse para cursos nuevos, pero
 * los cursos y alumnos que ya lo usan siguen intactos. Por eso la tabla muestra
 * cuántos cursos y alumnos lo están usando: es la información que hace falta
 * para decidir sin miedo.
 */

interface Horario {
  _id: string
  tipoCurso: string
  horario: string
  orden: number
  activo: boolean
  cursos: number
  alumnos: number
}

export default function HorariosPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.HORARIOS_GESTION} showDefaultMessage>
        <HorariosContent />
      </PermissionGuard>
    </DashboardLayout>
  )
}

function HorariosContent() {
  // Los cursos salen del catálogo (TIPOS_CURSO_CATALOGO), no de la constante:
  // un curso nuevo debe poder recibir horarios sin pasar por un despliegue.
  const { nombres: nombresCurso } = useTiposCurso()
  const [rows, setRows] = useState<Horario[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [verInactivos, setVerInactivos] = useState(false)
  const [filtroCurso, setFiltroCurso] = useState('')

  // Alta
  const [nuevoCurso, setNuevoCurso] = useState('')
  const [nuevoHorario, setNuevoHorario] = useState('')
  // Confirmación al desactivar uno que está en uso
  const [confirmar, setConfirmar] = useState<Horario | null>(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/postgres/horarios-curso?gestion=1', { cache: 'no-store' }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      setRows(r.horarios || [])
    } catch (e: any) { toast.error(e?.message || 'No se pudo cargar el catálogo') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const visibles = useMemo(
    () => rows.filter(h => (verInactivos || h.activo) && (!filtroCurso || h.tipoCurso === filtroCurso)),
    [rows, verInactivos, filtroCurso]
  )
  const porCurso = useMemo(() => {
    const m = new Map<string, Horario[]>()
    visibles.forEach(h => { if (!m.has(h.tipoCurso)) m.set(h.tipoCurso, []); m.get(h.tipoCurso)!.push(h) })
    // Orden del catálogo; los que no estén en él van al final (p. ej. un curso
    // desactivado que todavía tiene horarios en uso).
    const pos = (t: string) => {
      const i = nombresCurso.indexOf(t)
      return i < 0 ? 999 : i
    }
    return Array.from(m.entries()).sort((a, b) => pos(a[0]) - pos(b[0]))
  }, [visibles, nombresCurso])

  const agregar = async () => {
    if (!nuevoCurso || !nuevoHorario.trim()) { toast.error('Elige el curso y escribe el horario'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/postgres/horarios-curso', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipoCurso: nuevoCurso, horario: nuevoHorario }),
      }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      toast.success(r.message || 'Horario agregado')
      setNuevoHorario('')
      await cargar()
    } catch (e: any) { toast.error(e?.message || 'No se pudo agregar') }
    finally { setSaving(false) }
  }

  const toggle = async (h: Horario, activo: boolean) => {
    setSaving(true)
    try {
      const r = await fetch('/api/postgres/horarios-curso', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: h._id, activo }),
      }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      toast.success(r.message || 'Actualizado')
      setConfirmar(null)
      await cargar()
    } catch (e: any) { toast.error(e?.message || 'No se pudo actualizar') }
    finally { setSaving(false) }
  }

  const pedirQuitar = (h: Horario) => (h.cursos > 0 ? setConfirmar(h) : toggle(h, false))

  const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500'

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Horarios</h1>
        <p className="mt-2 text-gray-600">
          Horarios que se ofrecen al crear un curso de campaña. Quitar uno sólo deja de ofrecerlo:
          los cursos y alumnos que ya lo usan no se tocan.
        </p>
      </div>

      {/* Alta */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-3">Agregar horario</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label htmlFor="h-curso" className="block text-sm font-medium text-gray-700 mb-1">Curso</label>
            <select id="h-curso" value={nuevoCurso} onChange={e => setNuevoCurso(e.target.value)} className={`${input} bg-white`}>
              <option value="">Seleccionar…</option>
              {nombresCurso.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="h-horario" className="block text-sm font-medium text-gray-700 mb-1">Horario</label>
            <input id="h-horario" value={nuevoHorario} onChange={e => setNuevoHorario(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') agregar() }}
              placeholder="LUN-MIÉ 17:00-18:00" className={input} />
          </div>
          <button onClick={agregar} disabled={saving}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
            {saving ? 'Guardando…' : 'Agregar'}
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Formato: los días separados por guion y la franja. Por ejemplo <code>LUN-MIÉ 17:00-18:00</code>,
          {' '}<code>MAR-JUE 19:30-20:30</code>, <code>SÁB 09:00-11:00</code> o <code>LUN-MIÉ-VIE 20:00-21:00</code>.
          Con este texto se generan las clases del curso, así que uno mal escrito dejaría el calendario vacío —
          por eso se rechaza si no se puede interpretar.
        </p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <label htmlFor="f-curso" className="sr-only">Filtrar por curso</label>
          <select id="f-curso" value={filtroCurso} onChange={e => setFiltroCurso(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            <option value="">Todos los cursos</option>
            {nombresCurso.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={verInactivos} onChange={e => setVerInactivos(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
          Ver también los que ya no se ofrecen
        </label>
        <span className="text-sm text-gray-500">{visibles.length} horario(s)</span>
      </div>

      {/* Listado */}
      {loading ? (
        <p className="text-sm text-gray-400 py-10 text-center">Cargando…</p>
      ) : porCurso.length === 0 ? (
        <p className="text-sm text-gray-400 py-10 text-center">No hay horarios para mostrar.</p>
      ) : porCurso.map(([curso, lista]) => (
        <div key={curso} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <b className="text-sm text-gray-800">{curso}</b>
            <span className="text-xs text-gray-500">{lista.length} horario(s)</span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-left">
                <th className="text-xs font-semibold text-gray-600 uppercase px-4 py-2">Horario</th>
                <th className="text-xs font-semibold text-gray-600 uppercase px-3 py-2">En uso</th>
                <th className="text-xs font-semibold text-gray-600 uppercase px-3 py-2">Estado</th>
                <th className="text-xs font-semibold text-gray-600 uppercase px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {lista.map(h => (
                <tr key={h._id} className={`border-t border-gray-100 ${h.activo ? '' : 'bg-gray-50/60'}`}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{h.horario}</td>
                  <td className="px-3 py-3 text-sm text-gray-600">
                    {h.cursos === 0
                      ? <span className="text-gray-400">Sin usar</span>
                      : <>{h.cursos} curso(s) · {h.alumnos} alumno(s)</>}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex text-xs font-semibold rounded-full px-2.5 py-0.5 ${
                      h.activo ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                      {h.activo ? 'Se ofrece' : 'No se ofrece'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    {h.activo ? (
                      <button onClick={() => pedirQuitar(h)} disabled={saving}
                        className="px-3 py-1.5 rounded-lg border border-red-300 text-red-700 text-xs font-medium hover:bg-red-50 disabled:opacity-50">
                        Quitar
                      </button>
                    ) : (
                      <button onClick={() => toggle(h, true)} disabled={saving}
                        className="px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 text-xs font-medium hover:bg-emerald-50 disabled:opacity-50">
                        Volver a ofrecer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {confirmar && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setConfirmar(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Quitar {confirmar.horario}</h3>
            <p className="text-sm text-gray-600">
              Dejará de ofrecerse al crear cursos de <strong>{confirmar.tipoCurso}</strong>.
            </p>
            <div className="mt-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              Hoy lo usan <strong>{confirmar.cursos} curso(s)</strong> con <strong>{confirmar.alumnos} alumno(s)</strong>.
              No se tocan: siguen con su horario, sus clases y su salón. Sólo deja de aparecer en el desplegable.
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setConfirmar(null)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50">Cancelar</button>
              <button onClick={() => toggle(confirmar, false)} disabled={saving}
                className="px-5 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                {saving ? 'Guardando…' : 'Quitar del catálogo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
