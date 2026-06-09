'use client'

/**
 * /admin/actualizar-material/interactivo
 *
 * Panel admin para gestionar los libros del nuevo "Material Interactivo".
 *
 * Permite:
 *  - Ver el catálogo (7 libros: ESS, BEGINNER, PRACTICAL, FUNCTIONAL,
 *    IELTS, B2FIRST, TOEFL) y cuántas páginas tiene cada uno.
 *  - Ver/editar los rangos de páginas por nivel (BN1=1..100, etc.).
 *  - Subir audios MP3 por página (presigned PUT) y asociarlos a la BD.
 *  - Eliminar un audio asignado.
 *  - Activar/desactivar el feature flag global (con la consigna de hacer
 *    la prueba con direcciones internas antes de habilitarlo).
 *
 * NO incluye conversión PDF → imágenes — eso lo hace el script local
 * `scripts/upload-libro-interactivo.js`. Esta página muestra una nota con
 * el comando exacto para correrlo.
 *
 * Gateado por permiso ACADEMICO.MATERIAL.ACTUALIZAR.
 */

import { useEffect, useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { AcademicoPermission } from '@/types/permissions'
import {
  BookOpenIcon,
  SpeakerWaveIcon,
  TrashIcon,
  PlusIcon,
  ArrowUpTrayIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'

/**
 * Fetch tolerante a respuestas no-JSON (servidor a veces devuelve HTML de
 * error 500 cuando la BD está saturada de slots). Reintenta con backoff
 * simple si detecta un error retriable (500 / connection slots / database).
 */
async function jsonFetchRetry(input: RequestInfo, init?: RequestInit, retries = 2): Promise<any> {
  let lastErr: any
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(input, init)
      const txt = await r.text()
      let j: any = null
      try { j = txt ? JSON.parse(txt) : null } catch {}
      if (!r.ok || j?.success === false) {
        const msg = j?.error || `HTTP ${r.status}${txt ? ': ' + txt.slice(0, 160) : ''}`
        throw new Error(msg)
      }
      return j
    } catch (e: any) {
      lastErr = e
      const msg = (e?.message || '').toLowerCase()
      const isRetriable = msg.includes('500') || msg.includes('database') ||
                          msg.includes('connection') || msg.includes('reserved') ||
                          msg.includes('failed to fetch')
      if (!isRetriable || i === retries) throw e
      await new Promise(r => setTimeout(r, 1500 * (i + 1)))
    }
  }
  throw lastErr
}

interface LibroAudio {
  pagina: number
  key: string
  titulo?: string | null
}

interface NivelBinding {
  code: string
  libroInteractivoCode: string | null
  libroPaginaInicio: number | null
  libroPaginaFin: number | null
}

interface LibroAdmin {
  codigo: string
  titulo: string
  totalPaginas: number
  audios: LibroAudio[]
  activo: boolean
  niveles: NivelBinding[]
}

export default function ActualizarMaterialInteractivoPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.ACTUALIZAR_MATERIAL} showDefaultMessage>
        <Content />
      </PermissionGuard>
    </DashboardLayout>
  )
}

function Content() {
  const [libros, setLibros] = useState<LibroAdmin[]>([])
  const [featureActive, setFeatureActive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedCodigo, setExpandedCodigo] = useState<string | null>(null)
  const [savingFlag, setSavingFlag] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const j = await jsonFetchRetry('/api/admin/libros-interactivos')
      setLibros(j.libros || [])
      setFeatureActive(Boolean(j.featureActive))
    } catch (e: any) {
      setError(e?.message || 'Error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const toggleFlag = async () => {
    setSavingFlag(true)
    try {
      const j = await jsonFetchRetry('/api/admin/libros-interactivos/feature-flag', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !featureActive }),
      })
      setFeatureActive(j.active)
    } catch (e: any) {
      alert(e?.message || 'Error')
    } finally {
      setSavingFlag(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto py-6 px-4">
      <div className="flex items-center gap-3 mb-2">
        <BookOpenIcon className="h-7 w-7 text-emerald-600" />
        <h1 className="text-2xl font-bold text-gray-900">Material Interactivo</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Gestión de los libros que verá el estudiante en el panel. Cada libro se sube una vez y los sub-niveles (BN1/BN2/BN3, P1/P2/P3, F1/F2/F3) son <strong>rangos</strong> de páginas del mismo libro padre.
      </p>

      {/* Feature flag */}
      <div className={`rounded-xl border-l-4 p-4 mb-6 ${featureActive ? 'bg-emerald-50 border-emerald-500' : 'bg-amber-50 border-amber-500'}`}>
        <div className="flex items-start gap-3">
          {featureActive
            ? <CheckCircleIcon className="h-6 w-6 text-emerald-600 flex-shrink-0" />
            : <ExclamationTriangleIcon className="h-6 w-6 text-amber-600 flex-shrink-0" />}
          <div className="flex-1">
            <p className={`text-sm font-semibold ${featureActive ? 'text-emerald-900' : 'text-amber-900'}`}>
              {featureActive
                ? 'Feature ACTIVO — los estudiantes ven el botón nuevo (LGS) además del clásico (Wix).'
                : 'Feature INACTIVO — los estudiantes solo ven el botón clásico (Wix).'}
            </p>
            <p className="text-xs text-gray-700 mt-0.5">
              Recomendación: primero <strong>prueba las direcciones</strong> internas del visor (`/panel-estudiante/material-interactivo/[nivel]`) con tu cuenta, después actívalo para todos.
            </p>
          </div>
          <button
            onClick={toggleFlag}
            disabled={savingFlag}
            className={`px-4 py-2 rounded-lg text-sm font-semibold shrink-0 ${featureActive ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white'} disabled:opacity-50`}
          >
            {savingFlag ? '...' : featureActive ? 'Desactivar' : 'Activar'}
          </button>
        </div>
      </div>

      {/* Instructivo subida PDF */}
      <details className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-6 text-sm">
        <summary className="cursor-pointer font-semibold text-gray-800">📘 ¿Cómo subir un PDF nuevo?</summary>
        <div className="mt-2 text-xs text-gray-700 space-y-1">
          <p>La conversión PDF → imágenes se hace con un script local. Desde la raíz del repo:</p>
          <pre className="bg-gray-900 text-emerald-300 rounded p-2 overflow-x-auto text-[11px]">
node scripts/upload-libro-interactivo.js \
  --codigo=BEGINNER \
  --pdf=./libro-beginner.pdf \
  --titulo="Beginner — Let's Go Speak 2024" \
  --apply
          </pre>
          <p className="text-gray-600">Requiere `pdftoppm` (poppler-utils) instalado en el sistema operativo del que ejecuta el script.</p>
        </div>
      </details>

      {/* Listado de libros */}
      {loading
        ? <div className="text-sm text-gray-500">Cargando catálogo…</div>
        : error
          ? <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">{error}</div>
          : (
            <div className="space-y-4">
              {libros.map(libro => (
                <LibroCard
                  key={libro.codigo}
                  libro={libro}
                  expanded={expandedCodigo === libro.codigo}
                  onToggle={() => setExpandedCodigo(prev => prev === libro.codigo ? null : libro.codigo)}
                  onReload={load}
                />
              ))}
            </div>
          )
      }
    </div>
  )
}

function LibroCard({ libro, expanded, onToggle, onReload }: {
  libro: LibroAdmin
  expanded: boolean
  onToggle: () => void
  onReload: () => void
}) {
  const sinPaginas = libro.totalPaginas === 0
  return (
    <div className={`bg-white rounded-xl border ${sinPaginas ? 'border-amber-200' : 'border-gray-200'} shadow-sm overflow-hidden`}>
      <button onClick={onToggle} className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50">
        <div className="text-left">
          <div className="flex items-center gap-2">
            <BookOpenIcon className={`h-5 w-5 ${sinPaginas ? 'text-amber-500' : 'text-emerald-600'}`} />
            <h2 className="font-bold text-gray-800">{libro.codigo}</h2>
            <span className="text-xs text-gray-500">— {libro.titulo}</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {sinPaginas
              ? <span className="text-amber-700 font-medium">Sin páginas cargadas — corre el script de subida</span>
              : <>{libro.totalPaginas} páginas · {libro.audios.length} audios · {libro.niveles.length} nivel(es) vinculados</>}
          </p>
        </div>
        <span className="text-xs text-gray-400">{expanded ? 'Cerrar' : 'Abrir'}</span>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 p-5 space-y-5 bg-gray-50">
          <SeccionRangos libro={libro} onReload={onReload} />
          <SeccionAudios libro={libro} onReload={onReload} />
        </div>
      )}
    </div>
  )
}

function SeccionRangos({ libro, onReload }: { libro: LibroAdmin; onReload: () => void }) {
  const [rows, setRows] = useState(libro.niveles)
  useEffect(() => { setRows(libro.niveles) }, [libro.niveles])

  const save = async (n: NivelBinding) => {
    try {
      await jsonFetchRetry(`/api/admin/libros-interactivos/${encodeURIComponent(libro.codigo)}/binding`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nivelCode: n.code,
          libroInteractivoCode: libro.codigo,
          libroPaginaInicio: n.libroPaginaInicio,
          libroPaginaFin: n.libroPaginaFin,
        }),
      })
      onReload()
    } catch (e: any) { alert(e?.message || 'Error') }
  }

  if (rows.length === 0) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Niveles vinculados</h3>
        <p className="text-xs text-gray-500 italic">Ningún nivel apunta a este libro todavía.</p>
      </div>
    )
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">Rangos por nivel</h3>
      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="text-left px-3 py-2">Nivel</th>
              <th className="text-right px-3 py-2 w-28">Inicio</th>
              <th className="text-right px-3 py-2 w-28">Fin</th>
              <th className="text-right px-3 py-2 w-24">Páginas</th>
              <th className="text-right px-3 py-2 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n, idx) => {
              const fin = n.libroPaginaFin ?? libro.totalPaginas
              const inicio = n.libroPaginaInicio ?? 1
              const cantidad = libro.totalPaginas > 0 ? Math.max(0, fin - inicio + 1) : 0
              return (
                <tr key={n.code} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium">{n.code}</td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={1}
                      max={libro.totalPaginas || undefined}
                      value={n.libroPaginaInicio ?? 1}
                      onChange={e => {
                        const v = parseInt(e.target.value, 10) || 1
                        const next = [...rows]
                        next[idx] = { ...n, libroPaginaInicio: v }
                        setRows(next)
                      }}
                      className="w-20 border border-gray-300 rounded px-2 py-1 text-right tabular-nums"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={1}
                      max={libro.totalPaginas || undefined}
                      value={n.libroPaginaFin ?? ''}
                      placeholder="(final)"
                      onChange={e => {
                        const raw = e.target.value
                        const v = raw === '' ? null : (parseInt(raw, 10) || null)
                        const next = [...rows]
                        next[idx] = { ...n, libroPaginaFin: v }
                        setRows(next)
                      }}
                      className="w-20 border border-gray-300 rounded px-2 py-1 text-right tabular-nums"
                    />
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-gray-600 tabular-nums">{cantidad}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => save(n)}
                      className="text-xs px-2 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700"
                    >
                      Guardar
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SeccionAudios({ libro, onReload }: { libro: LibroAdmin; onReload: () => void }) {
  const [paginaNueva, setPaginaNueva] = useState<number | ''>('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

  const subir = async () => {
    if (typeof paginaNueva !== 'number' || paginaNueva < 1) {
      alert('Ingresa el número de página'); return
    }
    if (!file) { alert('Selecciona un archivo MP3'); return }
    setUploading(true)
    try {
      const presign = await jsonFetchRetry(`/api/admin/libros-interactivos/${encodeURIComponent(libro.codigo)}/audios/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pagina: paginaNueva, contentType: file.type || 'audio/mpeg' }),
      })

      const put = await fetch(presign.presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'audio/mpeg' },
        body: file,
      })
      if (!put.ok) throw new Error(`Upload S3 falló (${put.status})`)

      await jsonFetchRetry(`/api/admin/libros-interactivos/${encodeURIComponent(libro.codigo)}/audios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pagina: paginaNueva, key: presign.key }),
      })

      setFile(null); setPaginaNueva('')
      onReload()
    } catch (e: any) {
      alert(e?.message || 'Error')
    } finally {
      setUploading(false)
    }
  }

  const eliminar = async (pagina: number) => {
    if (!confirm(`¿Eliminar el audio de la página ${pagina}?`)) return
    try {
      await jsonFetchRetry(`/api/admin/libros-interactivos/${encodeURIComponent(libro.codigo)}/audios?pagina=${pagina}`, {
        method: 'DELETE',
      })
      onReload()
    } catch (e: any) {
      alert(e?.message || 'Error')
    }
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">Audios</h3>

      <div className="bg-white border border-gray-200 rounded p-3 mb-3">
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label htmlFor={`pag-${libro.codigo}`} className="block text-xs text-gray-600 mb-1">Página (del libro completo)</label>
            <input
              id={`pag-${libro.codigo}`}
              type="number"
              min={1}
              max={libro.totalPaginas || undefined}
              value={paginaNueva}
              onChange={e => setPaginaNueva(e.target.value === '' ? '' : parseInt(e.target.value, 10) || '')}
              className="w-24 border border-gray-300 rounded px-2 py-1 text-sm tabular-nums"
              placeholder="12"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label htmlFor={`audio-${libro.codigo}`} className="block text-xs text-gray-600 mb-1">Archivo MP3</label>
            <input
              id={`audio-${libro.codigo}`}
              type="file"
              accept="audio/mpeg,audio/mp3,.mp3"
              onChange={e => setFile(e.target.files?.[0] || null)}
              className="w-full text-xs"
            />
          </div>
          <button
            onClick={subir}
            disabled={uploading || !file || !paginaNueva}
            className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-40 flex items-center gap-1"
          >
            <ArrowUpTrayIcon className="h-4 w-4" />
            {uploading ? 'Subiendo…' : 'Subir audio'}
          </button>
        </div>
      </div>

      {libro.audios.length === 0 ? (
        <p className="text-xs text-gray-500 italic">Sin audios asignados.</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-right px-3 py-2 w-20">Página</th>
                <th className="text-left px-3 py-2">Key</th>
                <th className="text-right px-3 py-2 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {[...libro.audios].sort((a, b) => a.pagina - b.pagina).map(a => (
                <tr key={a.pagina} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-right font-bold tabular-nums">{a.pagina}</td>
                  <td className="px-3 py-2 text-xs text-gray-600 font-mono truncate">{a.key}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => eliminar(a.pagina)}
                      className="text-red-600 hover:text-red-800"
                      title="Eliminar audio"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
