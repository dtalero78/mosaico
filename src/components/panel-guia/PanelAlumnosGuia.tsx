'use client'

/**
 * "Mis alumnos por curso" de UN guía: carga el resumen, mantiene el curso elegido
 * y pinta encabezado + vista. Lo usan las dos puertas, así no hay dos copias:
 *  - la página completa /panel-advisor/alumnos (encabezado grande, selector de guía);
 *  - la pestaña "Mis alumnos" del Panel Guía (`embebido`: encabezado compacto,
 *    el guía es el del panel).
 * Quién puede ver a qué guía lo decide el endpoint.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { exportToExcel } from '@/lib/export-excel'
import { columnasCsvPanelGuia, nombreArchivoCsv } from '@/lib/panel-guia-csv'
import type { ResumenGuia, CursoResumenGuia } from '@/services/resumen-guia.service'
import PanelAlumnosVista, { EsqueletoPanel } from './PanelAlumnosVista'

const fmtCorte = (iso: string) =>
  new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(iso)).replace('.', '').replace(/\bsept\b/, 'sep')

export default function PanelAlumnosGuia({ guiaId, cursoInicial = '', embebido = false, acciones }: {
  guiaId: string
  cursoInicial?: string
  embebido?: boolean
  /** Controles extra junto a "Exportar CSV" (p. ej. el selector de guía). */
  acciones?: ReactNode
}) {
  const [data, setData] = useState<ResumenGuia | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cursoSel, setCursoSel] = useState<string>(cursoInicial)

  const cargar = useCallback(async () => {
    if (!guiaId) return
    setCargando(true); setError(null)
    try {
      const res = await fetch(`/api/postgres/guias/${encodeURIComponent(guiaId)}/resumen-alumnos`, { cache: 'no-store' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j.success === false) throw new Error(j.error || 'No se pudo cargar el panel')
      setData(j as ResumenGuia)
    } catch (e: any) {
      setData(null); setError(e?.message || 'No se pudo cargar el panel')
    } finally { setCargando(false) }
  }, [guiaId])
  useEffect(() => { cargar() }, [cargar])

  // El curso elegido: el pedido si es de este guía; si no, el primero.
  const curso: CursoResumenGuia | null = useMemo(() => {
    const cs = data?.cursos || []
    return cs.find(c => c.cursoId === cursoSel) || cs[0] || null
  }, [data, cursoSel])

  const exportar = () => {
    if (!curso) return
    exportToExcel(curso.filas, columnasCsvPanelGuia(curso), nombreArchivoCsv(curso), { separator: ';' })
  }

  const subtitulo = `${data?.guia.nombre || '—'}${data ? ` · Corte al ${fmtCorte(data.corte)}` : ''}`
  const botones = (
    <div className="flex flex-wrap items-center gap-2">
      {acciones}
      <button type="button" onClick={exportar} disabled={!curso || curso.filas.length === 0}
        className="min-h-[44px] rounded-[14px] border border-[#E1E6EC] bg-white px-5 text-sm font-medium text-[#17212B] hover:border-primary-300 disabled:opacity-50">
        Exportar CSV
      </button>
    </div>
  )

  return (
    <div>
      {embebido ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[#556270]">{subtitulo}</p>
          {botones}
        </div>
      ) : (
        <header className="mt-1 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-widest text-primary-600 uppercase">MOSAICO · Panel del guía</p>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#17212B]">Mis alumnos por curso</h1>
            <p className="text-sm text-[#556270]">{subtitulo}</p>
          </div>
          {botones}
        </header>
      )}

      {error ? (
        <div role="alert" className="mt-6 rounded-[14px] border border-[#F5C2BC] bg-[#FDECEA] p-4 text-sm text-[#9A1B12]">
          No se pudo cargar el panel: {error}
          <button type="button" onClick={cargar} className="ml-3 min-h-[44px] rounded-lg px-2 font-medium underline">Reintentar</button>
        </div>
      ) : cargando || !data ? (
        <EsqueletoPanel />
      ) : !curso ? (
        <div className="mt-6 rounded-[14px] border border-[#E1E6EC] bg-white p-8 text-center text-sm text-[#556270]">
          Este guía no tiene cursos vigentes.
        </div>
      ) : (
        <PanelAlumnosVista cursos={data.cursos} cursoActivo={curso} onElegirCurso={setCursoSel} guiaId={guiaId} onRecargar={cargar} />
      )}
    </div>
  )
}
