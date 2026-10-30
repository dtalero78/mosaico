'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from 'react-query'
import Link from 'next/link'
import {
  ArrowLeftIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  PhotoIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

/**
 * Mantenimiento › Avisos › Banner: carrusel de hasta 3 imágenes en el login.
 * Cada aviso se agrega, quita, ordena, enciende/apaga y programa (desde/hasta) por
 * separado; quitar uno no toca los demás. API: /api/postgres/config/banner/avisos.
 */

interface Aviso {
  id: string
  nombre: string
  activo: boolean
  orden: number
  desde: string | null
  hasta: string | null
  subidoPor: string | null
  subidoEn: string
  vigente: boolean
  url: string
}

interface Estado {
  active: boolean
  hoy: string
  max: number
  avisos: Aviso[]
}

const API = '/api/postgres/config/banner/avisos'

async function pedir(method: string, body?: BodyInit | object, query = ''): Promise<Estado> {
  const esForm = body instanceof FormData
  const res = await fetch(API + query, {
    method,
    headers: body && !esForm ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? (esForm ? (body as FormData) : JSON.stringify(body)) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.success === false) throw new Error(json.error || 'Error al guardar')
  return json
}

const fmtFecha = (f: string) => {
  const [y, m, d] = f.split('-')
  return `${d}/${m}/${y}`
}

function estadoAviso(a: Aviso, hoy: string): { texto: string; clase: string } {
  if (!a.activo) return { texto: 'Apagado', clase: 'bg-gray-100 text-gray-600' }
  if (a.desde && hoy < a.desde) return { texto: `Programado desde ${fmtFecha(a.desde)}`, clase: 'bg-blue-100 text-blue-700' }
  if (a.hasta && hoy > a.hasta) return { texto: `Venció el ${fmtFecha(a.hasta)}`, clase: 'bg-amber-100 text-amber-700' }
  return { texto: 'Visible', clase: 'bg-green-100 text-green-700' }
}

export default function BannerPage() {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery<Estado>('banner-avisos', () => pedir('GET'), { staleTime: 0 })
  const [ocupado, setOcupado] = useState(false)

  const ejecutar = async (fn: () => Promise<Estado>, ok: string) => {
    setOcupado(true)
    try {
      const nuevo = await fn()
      queryClient.setQueryData('banner-avisos', nuevo)
      toast.success(ok)
      return true
    } catch (e: any) {
      toast.error(e.message || 'Error al guardar')
      return false
    } finally {
      setOcupado(false)
    }
  }

  const avisos = data?.avisos ?? []
  const hoy = data?.hoy ?? ''
  const max = data?.max ?? 3
  const visibles = avisos.filter(a => a.vigente).length

  /** Guarda la lista completa (orden + campos) con un cambio aplicado. */
  const guardarLista = (lista: Aviso[], ok: string) =>
    ejecutar(() => pedir('PATCH', {
      avisos: lista.map(a => ({ id: a.id, nombre: a.nombre, activo: a.activo, desde: a.desde, hasta: a.hasta })),
    }), ok)

  const mover = (i: number, d: -1 | 1) => {
    const lista = [...avisos]
    ;[lista[i], lista[i + d]] = [lista[i + d], lista[i]]
    guardarLista(lista, 'Orden actualizado')
  }

  const actualizar = (id: string, cambios: Partial<Aviso>, ok: string) =>
    guardarLista(avisos.map(a => (a.id === id ? { ...a, ...cambios } : a)), ok)

  const quitar = (a: Aviso) => {
    const resto = avisos.length - 1
    const msg = resto > 0
      ? `¿Quitar el aviso "${a.nombre}"? Los otros ${resto === 1 ? 'aviso sigue' : `${resto} avisos siguen`} igual.`
      : `¿Quitar el aviso "${a.nombre}"? Es el único: el login quedará sin avisos.`
    if (!window.confirm(msg)) return
    ejecutar(() => pedir('DELETE', undefined, `?id=${encodeURIComponent(a.id)}`), 'Aviso quitado')
  }

  const toggleGeneral = (v: boolean) => {
    if (!window.confirm(`¿${v ? 'Mostrar' : 'Ocultar'} los avisos en el login?`)) return
    ejecutar(() => pedir('PATCH', { active: v }), v ? 'Avisos activados' : 'Avisos ocultos')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors">
          <ArrowLeftIcon className="h-4 w-4" />
          Volver al Dashboard
        </Link>
        <div className="h-4 w-px bg-gray-300" />
        <div className="flex items-center gap-2">
          <PhotoIcon className="h-5 w-5 text-primary-600" />
          <h1 className="text-lg font-semibold text-gray-900">Avisos del login</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {error ? (
          <div className="card p-5 text-sm text-red-600">{(error as Error).message}</div>
        ) : null}

        {/* Interruptor general */}
        <div className="card p-5 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-gray-900">Mostrar avisos en el login</p>
            <p className="text-sm text-gray-500 mt-0.5">
              {!data?.active
                ? 'Desactivado: el login no muestra ningún aviso.'
                : visibles === 0
                  ? 'Activado, pero hoy no hay avisos visibles.'
                  : visibles === 1
                    ? 'Hoy se ve 1 aviso.'
                    : `Hoy se ven ${visibles} avisos en carrusel (flechas, puntos y "Siguiente aviso").`}
            </p>
          </div>
          <Interruptor
            valor={!!data?.active}
            onChange={toggleGeneral}
            disabled={ocupado || isLoading}
            etiqueta="Mostrar avisos en el login"
          />
        </div>

        {/* Lista de avisos */}
        <div className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Avisos ({avisos.length} de {max})
            </h2>
            <p className="text-xs text-gray-400">Se muestran en este orden</p>
          </div>

          {isLoading ? (
            <div className="h-40 bg-gray-100 rounded animate-pulse" />
          ) : avisos.length === 0 ? (
            <div className="h-24 flex items-center justify-center rounded-lg bg-gray-100 text-sm text-gray-400">
              No hay avisos cargados
            </div>
          ) : (
            avisos.map((a, i) => (
              <TarjetaAviso
                key={`${a.id}-${a.desde}-${a.hasta}-${a.nombre}`}
                aviso={a}
                posicion={i + 1}
                hoy={hoy}
                ocupado={ocupado}
                primero={i === 0}
                ultimo={i === avisos.length - 1}
                onSubir={() => mover(i, -1)}
                onBajar={() => mover(i, 1)}
                onQuitar={() => quitar(a)}
                onActivo={v => actualizar(a.id, { activo: v }, v ? 'Aviso encendido' : 'Aviso apagado')}
                onGuardar={c => actualizar(a.id, c, 'Aviso actualizado')}
              />
            ))
          )}
        </div>

        {/* Agregar */}
        {!isLoading && (
          avisos.length >= max ? (
            <div className="card p-5 text-sm text-gray-500">
              Ya hay {max} avisos, el máximo. Quite uno para agregar otro.
            </div>
          ) : (
            <NuevoAviso
              ocupado={ocupado}
              onAgregar={form => ejecutar(() => pedir('POST', form), 'Aviso agregado')}
            />
          )
        )}
      </div>
    </div>
  )
}

function Interruptor({ valor, onChange, disabled, etiqueta }: {
  valor: boolean; onChange: (v: boolean) => void; disabled?: boolean; etiqueta: string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!valor)}
      disabled={disabled}
      aria-label={etiqueta}
      aria-pressed={valor}
      title={etiqueta}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${valor ? 'bg-green-500' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${valor ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

function TarjetaAviso({ aviso, posicion, hoy, ocupado, primero, ultimo, onSubir, onBajar, onQuitar, onActivo, onGuardar }: {
  aviso: Aviso; posicion: number; hoy: string; ocupado: boolean; primero: boolean; ultimo: boolean
  onSubir: () => void; onBajar: () => void; onQuitar: () => void
  onActivo: (v: boolean) => void
  onGuardar: (c: Partial<Aviso>) => void
}) {
  const [nombre, setNombre] = useState(aviso.nombre)
  const [desde, setDesde] = useState(aviso.desde ?? '')
  const [hasta, setHasta] = useState(aviso.hasta ?? '')
  const cambiado = nombre.trim() !== aviso.nombre || desde !== (aviso.desde ?? '') || hasta !== (aviso.hasta ?? '')
  const est = estadoAviso(aviso, hoy)

  return (
    <div className="card p-4 flex flex-col sm:flex-row gap-4">
      <a href={aviso.url} target="_blank" rel="noopener noreferrer" className="sm:w-40 flex-shrink-0 rounded-lg overflow-hidden border border-gray-200 bg-gray-900 flex items-center justify-center" title="Ver en tamaño completo">
        <img src={aviso.url} alt={aviso.nombre} className="w-full max-h-48 object-contain" />
      </a>

      <div className="flex-1 min-w-0 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-500">#{posicion}</span>
          <input
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            maxLength={80}
            aria-label="Nombre del aviso"
            className="flex-1 min-w-[10rem] text-sm font-medium border border-gray-200 rounded px-2 py-1"
          />
          <span className={`text-xs px-2 py-0.5 rounded-full ${est.clase}`}>{est.texto}</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-600">
            Mostrar desde
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="mt-1 w-full text-sm border border-gray-200 rounded px-2 py-1" />
          </label>
          <label className="text-xs text-gray-600">
            Mostrar hasta (inclusive)
            <input type="date" value={hasta} min={desde || undefined} onChange={e => setHasta(e.target.value)} className="mt-1 w-full text-sm border border-gray-200 rounded px-2 py-1" />
          </label>
        </div>
        <p className="text-[11px] text-gray-400">Sin fechas = se muestra siempre mientras esté encendido.</p>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 mr-auto">
            <Interruptor valor={aviso.activo} onChange={onActivo} disabled={ocupado} etiqueta={aviso.activo ? 'Apagar aviso' : 'Encender aviso'} />
            <span className="text-xs text-gray-600">{aviso.activo ? 'Encendido' : 'Apagado'}</span>
          </div>
          {cambiado && (
            <button
              type="button"
              disabled={ocupado || (!!desde && !!hasta && desde > hasta)}
              onClick={() => onGuardar({ nombre: nombre.trim() || aviso.nombre, desde: desde || null, hasta: hasta || null })}
              className="px-3 py-1.5 text-xs bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              Guardar cambios
            </button>
          )}
          <button type="button" onClick={onSubir} disabled={ocupado || primero} title="Mostrar antes" aria-label="Subir" className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30">
            <ArrowUpIcon className="h-4 w-4" />
          </button>
          <button type="button" onClick={onBajar} disabled={ocupado || ultimo} title="Mostrar después" aria-label="Bajar" className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30">
            <ArrowDownIcon className="h-4 w-4" />
          </button>
          <button type="button" onClick={onQuitar} disabled={ocupado} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50">
            <TrashIcon className="h-3.5 w-3.5" />
            Quitar
          </button>
        </div>
        <p className="text-[11px] text-gray-400">
          Subido{aviso.subidoPor ? ` por ${aviso.subidoPor}` : ''} · {new Date(aviso.subidoEn).toLocaleString('es-CO')}
        </p>
      </div>
    </div>
  )
}

function NuevoAviso({ ocupado, onAgregar }: { ocupado: boolean; onAgregar: (f: FormData) => Promise<boolean> }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [nombre, setNombre] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const elegir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/')) return void toast.error('Solo se permiten imágenes')
    if (f.size > 7 * 1024 * 1024) return void toast.error('La imagen no puede superar 7 MB')
    setArchivo(f)
    setPreview(URL.createObjectURL(f))
  }

  /** Descarta la imagen elegida (aún no publicada) sin tocar los avisos existentes. */
  const descartar = () => {
    setArchivo(null)
    setPreview(null)
  }

  const agregar = async () => {
    if (!archivo) return
    if (desde && hasta && desde > hasta) return void toast.error('"Desde" no puede ser posterior a "hasta"')
    const form = new FormData()
    form.append('file', archivo)
    form.append('nombre', nombre)
    form.append('desde', desde)
    form.append('hasta', hasta)
    if (await onAgregar(form)) {
      setArchivo(null); setPreview(null); setNombre(''); setDesde(''); setHasta('')
    }
  }

  return (
    <div className="card p-5 space-y-4">
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
        <PlusIcon className="h-4 w-4" /> Agregar aviso
      </h2>

      <div
        onClick={() => inputRef.current?.click()}
        className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg py-8 cursor-pointer hover:border-primary-400 hover:bg-gray-50 transition-colors overflow-hidden"
      >
        {preview ? (
          <img src={preview} alt="Vista previa" className="max-h-64 object-contain" />
        ) : (
          <>
            <PhotoIcon className="h-10 w-10 text-gray-400 mb-2" />
            <p className="text-sm text-gray-500">Haz clic para seleccionar una imagen</p>
            <p className="text-xs text-gray-400 mt-1">PNG, JPG, GIF, WEBP — máx. 7 MB</p>
          </>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" aria-label="Seleccionar imagen del aviso" onChange={elegir} />

      {archivo && (
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className="text-gray-600 truncate max-w-xs" title={archivo.name}>{archivo.name}</span>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={ocupado}
            className="ml-auto px-3 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cambiar imagen
          </button>
          <button
            type="button"
            onClick={descartar}
            disabled={ocupado}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            Quitar imagen
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="text-xs text-gray-600">
          Nombre (referencia interna)
          <input value={nombre} onChange={e => setNombre(e.target.value)} maxLength={80} placeholder="Ej. Feriado 31-oct Chile" className="mt-1 w-full text-sm border border-gray-200 rounded px-2 py-1" />
        </label>
        <label className="text-xs text-gray-600">
          Mostrar desde (opcional)
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="mt-1 w-full text-sm border border-gray-200 rounded px-2 py-1" />
        </label>
        <label className="text-xs text-gray-600">
          Mostrar hasta (opcional)
          <input type="date" value={hasta} min={desde || undefined} onChange={e => setHasta(e.target.value)} className="mt-1 w-full text-sm border border-gray-200 rounded px-2 py-1" />
        </label>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={agregar}
          disabled={ocupado || !archivo}
          className="px-6 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {ocupado ? 'Guardando...' : 'Agregar y publicar'}
        </button>
      </div>
    </div>
  )
}
