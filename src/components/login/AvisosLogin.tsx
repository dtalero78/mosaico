'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, XMarkIcon } from '@heroicons/react/24/outline'

/**
 * Avisos del login (Mantenimiento › Avisos › Banner). Con un solo aviso se ve igual que
 * siempre; con 2 o 3 se recorren con flechas, puntos, deslizando el dedo o con el botón
 * "Siguiente". Se cierra una vez por sesión del navegador.
 */

const DISMISSED_KEY = 'mosaico_banner_dismissed'

interface Aviso { id: string; url: string }

export default function AvisosLogin() {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [idx, setIdx] = useState(0)
  const [visible, setVisible] = useState(false)
  const touchX = useRef<number | null>(null)

  useEffect(() => {
    try { if (sessionStorage.getItem(DISMISSED_KEY)) return } catch {}
    fetch('/api/postgres/config/banner')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        const lista: Aviso[] = Array.isArray(data?.avisos) ? data.avisos.filter((a: Aviso) => a?.url) : []
        if (lista.length) { setAvisos(lista); setVisible(true) }
      })
      .catch(() => {})
  }, [])

  if (!visible || !avisos.length) return null

  const total = avisos.length
  const ultimo = idx === total - 1
  const ir = (n: number) => setIdx((n + total) % total)
  const cerrar = () => {
    setVisible(false)
    try { sessionStorage.setItem(DISMISSED_KEY, '1') } catch {}
  }
  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0].clientX }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null || total < 2) return
    const dx = e.changedTouches[0].clientX - touchX.current
    touchX.current = null
    if (Math.abs(dx) > 40) ir(idx + (dx < 0 ? 1 : -1))
  }

  const botonCerrar = (
    <button
      type="button"
      onClick={cerrar}
      className="absolute top-2 right-2 z-20 bg-white rounded-full p-1.5 shadow-lg hover:bg-gray-100 transition-colors"
      title="Cerrar"
      aria-label="Cerrar avisos"
    >
      <XMarkIcon className="h-5 w-5 text-gray-700" />
    </button>
  )

  const flechas = total > 1 && (
    <>
      <button
        type="button"
        onClick={() => ir(idx - 1)}
        className="absolute left-2 top-1/2 -translate-y-1/2 z-20 bg-white/85 rounded-full p-1.5 shadow hover:bg-white"
        aria-label="Aviso anterior"
      >
        <ChevronLeftIcon className="h-5 w-5 text-gray-700" />
      </button>
      <button
        type="button"
        onClick={() => ir(idx + 1)}
        className="absolute right-2 top-1/2 -translate-y-1/2 z-20 bg-white/85 rounded-full p-1.5 shadow hover:bg-white"
        aria-label="Aviso siguiente"
      >
        <ChevronRightIcon className="h-5 w-5 text-gray-700" />
      </button>
    </>
  )

  const pie = (
    <div className="flex-shrink-0 bg-white">
      {total > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2" role="tablist" aria-label="Avisos">
          {avisos.map((a, i) => (
            <button
              key={a.id}
              type="button"
              onClick={() => ir(i)}
              aria-label={`Aviso ${i + 1} de ${total}`}
              aria-selected={i === idx}
              role="tab"
              className={`h-2 rounded-full transition-all ${i === idx ? 'w-5 bg-primary-600' : 'w-2 bg-gray-300 hover:bg-gray-400'}`}
            />
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={ultimo ? cerrar : () => ir(idx + 1)}
        className="w-full py-2.5 px-4 hover:bg-gray-100 text-gray-800 text-sm font-medium transition-colors"
      >
        {ultimo ? 'Cerrar y continuar al login' : `Siguiente aviso (${idx + 1} de ${total})`}
      </button>
    </div>
  )

  // Todas las imágenes quedan montadas (se precargan); solo se muestra la actual.
  const imagenes = (clase: string) => avisos.map((a, i) => (
    <img
      key={a.id}
      src={a.url}
      alt={`Aviso ${i + 1}`}
      className={i === idx ? clase : 'hidden'}
      aria-hidden={i !== idx}
    />
  ))

  return (
    <>
      {/* Mobile: card centrado con backdrop — imagen a tamaño natural, sin distorsión */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 sm:hidden">
        <div
          className="relative w-[88vw] max-w-sm rounded-xl overflow-hidden shadow-2xl bg-white"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {botonCerrar}
          <div className="relative">
            {imagenes('w-full h-auto block')}
            {flechas}
          </div>
          {pie}
        </div>
      </div>

      {/* Desktop (sm+): overlay sobre el card del login */}
      <div className="hidden sm:flex absolute inset-0 z-10 flex-col rounded-xl overflow-hidden shadow-2xl bg-white">
        {botonCerrar}
        <div className="relative flex-1 min-h-0 flex">
          {imagenes('w-full flex-1 min-h-0 object-cover object-top')}
          {flechas}
        </div>
        {pie}
      </div>
    </>
  )
}
