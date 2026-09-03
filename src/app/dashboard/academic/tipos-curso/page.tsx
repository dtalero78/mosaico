'use client'

import { useCallback, useEffect, useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { AcademicoPermission } from '@/types/permissions'
import toast from 'react-hot-toast'

/**
 * Catálogo de tipos de curso.
 *
 * Vivía en una constante del código, así que cargar el currículo de un curso
 * nuevo en NIVELES no bastaba para poder usarlo: no salía en ningún desplegable
 * ni pasaba las validaciones del servidor.
 *
 * Quitar un curso lo DESACTIVA: deja de ofrecerse para cursos de campaña nuevos,
 * pero los que ya lo usan siguen intactos — mismo criterio que en Horarios. Y el
 * NOMBRE no se edita: es la llave con la que quedaron guardados los alumnos.
 */

interface TipoCurso {
  _id: string
  tipoCurso: string
  esMenores: boolean
  usaApoderado: boolean
  orden: number
  activo: boolean
}

export default function TiposCursoPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.TIPOS_CURSO_GESTION} showDefaultMessage>
        <Contenido />
      </PermissionGuard>
    </DashboardLayout>
  )
}

function Contenido() {
  const [tipos, setTipos] = useState<TipoCurso[]>([])
  const [cargando, setCargando] = useState(true)
  const [verInactivos, setVerInactivos] = useState(false)
  const [nombre, setNombre] = useState('')
  const [esMenores, setEsMenores] = useState(false)
  const [usaApoderado, setUsaApoderado] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [confirmar, setConfirmar] = useState<TipoCurso | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const r = await fetch('/api/postgres/tipos-curso?incluirInactivos=true', { cache: 'no-store' })
      const j = await r.json()
      setTipos(Array.isArray(j?.tipos) ? j.tipos : [])
    } catch {
      toast.error('No se pudo cargar el catálogo')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const agregar = async () => {
    const n = nombre.trim()
    if (!n) { toast.error('Escribe el nombre del curso'); return }
    setGuardando(true)
    try {
      const r = await fetch('/api/postgres/tipos-curso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipoCurso: n, esMenores, usaApoderado }),
      })
      const j = await r.json()
      if (!r.ok || j?.success === false) throw new Error(j?.error || 'Error')
      toast.success(`Curso "${j.tipo.tipoCurso}" agregado`)
      setNombre(''); setEsMenores(false); setUsaApoderado(false)
      cargar()
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo agregar')
    } finally {
      setGuardando(false)
    }
  }

  const cambiar = async (t: TipoCurso, cambios: Partial<TipoCurso>) => {
    try {
      const r = await fetch('/api/postgres/tipos-curso', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _id: t._id, ...cambios }),
      })
      const j = await r.json()
      if (!r.ok || j?.success === false) throw new Error(j?.error || 'Error')
      setTipos(prev => prev.map(x => x._id === t._id ? { ...x, ...cambios } : x))
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo guardar')
      cargar()
    }
  }

  const visibles = verInactivos ? tipos : tipos.filter(t => t.activo)

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900">Tipos de Curso</h1>
      <p className="mt-2 text-gray-600">
        Cursos que se ofrecen en toda la plataforma. Agregar uno aquí lo habilita en Horarios,
        Crear Campaña, Crear Contrato y Mantenimiento Cursos. Quitarlo sólo deja de ofrecerlo:
        los cursos y alumnos que ya lo usan no se tocan.
      </p>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide mb-4">Agregar curso</h2>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
          <div>
            <label htmlFor="nombre" className="block text-sm font-medium text-gray-700">Nombre</label>
            <input
              id="nombre" value={nombre}
              onChange={e => setNombre(e.target.value.toUpperCase())}
              placeholder="DANSHI-SENPAI"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm uppercase"
            />
            <p className="mt-1 text-xs text-gray-500">
              Debe coincidir con el <strong>curso del currículo</strong> cargado en NIVELES. Letras,
              números, espacios y guiones. No se puede cambiar después: es la llave con la que
              quedan guardados los alumnos.
            </p>
          </div>
          <button
            type="button" onClick={agregar} disabled={guardando}
            className="px-6 py-2 rounded-md bg-primary-700 text-white text-sm font-medium hover:bg-primary-800 disabled:opacity-50"
          >
            {guardando ? 'Agregando…' : 'Agregar'}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-6">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={esMenores} onChange={e => setEsMenores(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="font-medium text-gray-800">Es curso de menores</span>
              <span className="block text-xs text-gray-500">El titular no puede ser su propio alumno: se exige un apoderado distinto.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={usaApoderado} onChange={e => setUsaApoderado(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="font-medium text-gray-800">Los mensajes van al apoderado</span>
              <span className="block text-xs text-gray-500">Bienvenida y recordatorios llegan al apoderado, no al alumno.</span>
            </span>
          </label>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={verInactivos} onChange={e => setVerInactivos(e.target.checked)} />
          Ver también los que ya no se ofrecen
        </label>
        <span className="text-sm text-gray-500">{visibles.length} curso(s)</span>
      </div>

      <div className="mt-3 rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-700">
            <tr>
              <th className="px-4 py-3 font-medium">CURSO</th>
              <th className="px-4 py-3 font-medium">DE MENORES</th>
              <th className="px-4 py-3 font-medium">MENSAJES AL APODERADO</th>
              <th className="px-4 py-3 font-medium">ESTADO</th>
              <th className="px-4 py-3 font-medium text-right">ACCIONES</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {cargando && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!cargando && !visibles.length && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">Sin cursos en el catálogo.</td></tr>
            )}
            {visibles.map(t => (
              <tr key={t._id} className={t.activo ? '' : 'bg-gray-50 text-gray-400'}>
                <td className="px-4 py-3 font-medium">{t.tipoCurso}</td>
                <td className="px-4 py-3">
                  <input type="checkbox" checked={t.esMenores} disabled={!t.activo}
                    onChange={e => cambiar(t, { esMenores: e.target.checked })} />
                </td>
                <td className="px-4 py-3">
                  <input type="checkbox" checked={t.usaApoderado} disabled={!t.activo}
                    onChange={e => cambiar(t, { usaApoderado: e.target.checked })} />
                </td>
                <td className="px-4 py-3">
                  {t.activo
                    ? <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-xs font-medium">Se ofrece</span>
                    : <span className="px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 text-xs font-medium">Ya no se ofrece</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  {t.activo ? (
                    <button type="button" onClick={() => setConfirmar(t)}
                      className="px-3 py-1.5 rounded-md border border-red-300 text-red-700 text-xs font-medium hover:bg-red-50">
                      Quitar
                    </button>
                  ) : (
                    <button type="button" onClick={() => cambiar(t, { activo: true })}
                      className="px-3 py-1.5 rounded-md border border-green-300 text-green-700 text-xs font-medium hover:bg-green-50">
                      Reactivar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirmar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setConfirmar(null)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Quitar {confirmar.tipoCurso}</h3>
            <p className="text-sm text-gray-600 mb-5">
              Dejará de ofrecerse al crear cursos de campaña, horarios y contratos.
              Los cursos y alumnos que ya lo usan <strong>no se tocan</strong> y siguen operando igual.
              Se puede reactivar cuando quiera.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmar(null)}
                className="px-4 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">
                Cancelar
              </button>
              <button type="button"
                onClick={() => { cambiar(confirmar, { activo: false }); setConfirmar(null) }}
                className="px-4 py-2 text-sm rounded-md bg-red-600 text-white hover:bg-red-700">
                Quitar del catálogo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
