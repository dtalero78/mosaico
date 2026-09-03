'use client'

import { useEffect, useState } from 'react'
import { TIPOS_CURSO } from '@/lib/cursos-campaign'

/**
 * Catálogo de tipos de curso para los desplegables.
 *
 * Antes cada pantalla mapeaba la constante `TIPOS_CURSO`, así que un curso nuevo
 * en el catálogo no aparecía hasta desplegar. Ahora se lee de la base.
 *
 * Arranca con la constante como valor inicial (no con una lista vacía) para que
 * el desplegable nunca se vea sin opciones mientras carga, y para que siga
 * funcionando si el endpoint falla.
 */

export interface TipoCursoItem {
  tipoCurso: string
  esMenores: boolean
  usaApoderado: boolean
}

const RESPALDO: TipoCursoItem[] = (TIPOS_CURSO as readonly string[]).map(t => ({
  tipoCurso: t,
  esMenores: t === 'YOJI' || t === 'OKINA' || t === 'KODOMO',
  usaApoderado: t === 'YOJI' || t === 'OKINA' || t === 'KODOMO' || t === 'DANSHI',
}))

export function useTiposCurso() {
  const [tipos, setTipos] = useState<TipoCursoItem[]>(RESPALDO)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vivo = true
    fetch('/api/postgres/tipos-curso', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        if (!vivo) return
        const lista = Array.isArray(j?.tipos) ? j.tipos : []
        if (lista.length) setTipos(lista)
      })
      .catch(() => { /* se conserva el respaldo */ })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [])

  return {
    tipos,
    nombres: tipos.map(t => t.tipoCurso),
    cargando,
    esMenores: (t: string) => tipos.find(x => x.tipoCurso === t)?.esMenores ?? false,
  }
}
