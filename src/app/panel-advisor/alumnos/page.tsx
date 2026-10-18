'use client'

/**
 * Panel del guía › "Mis alumnos por curso" (/panel-advisor/alumnos).
 *
 * Se abre en otra pestaña desde Panel Guía › Cursos asignados (clic en el nombre
 * del curso): `?guia=<GUIAS._id>&curso=<CURSOS_CAMPAIGN._id>`. Página completa,
 * sin menú lateral: la tabla necesita el ancho.
 *
 * Quién ve qué lo decide el endpoint; aquí sólo se elige qué pedir:
 *  - rol GUIA → siempre su propio panel (resuelto por su correo; `?guia=` se ignora);
 *  - con "ver todos" → el `?guia=` pedido o el primero de la lista, con selector;
 *  - el resto → su propio panel si tiene ficha de guía.
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { usePermissions } from '@/hooks/usePermissions'
import { AcademicoPermission } from '@/types/permissions'
import { exportToExcel } from '@/lib/export-excel'
import { columnasCsvPanelGuia, nombreArchivoCsv } from '@/lib/panel-guia-csv'
import type { ResumenGuia, CursoResumenGuia } from '@/services/resumen-guia.service'
import PanelAlumnosVista, { EsqueletoPanel } from '@/components/panel-guia/PanelAlumnosVista'

type GuiaOpcion = { _id: string; nombreCompleto?: string | null; email?: string | null }

const fmtCorte = (iso: string) =>
  new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(iso)).replace('.', '')

function PanelAlumnos() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session, status } = useSession()
  const { hasPermission, isLoading: permsLoading } = usePermissions()

  const rol = (session?.user as any)?.role as string | undefined
  const email = session?.user?.email || ''
  const esGuia = rol === 'GUIA'
  const verTodos = !esGuia && hasPermission(AcademicoPermission.PANEL_ALUMNOS_VER_TODOS)

  const guiaParam = searchParams.get('guia') || ''
  const cursoParam = searchParams.get('curso') || ''

  const [guiaId, setGuiaId] = useState<string | null>(null)
  const [guias, setGuias] = useState<GuiaOpcion[]>([])
  const [data, setData] = useState<ResumenGuia | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cursoSel, setCursoSel] = useState<string>(cursoParam)

  // 1. Qué guía pedir.
  useEffect(() => {
    if (status !== 'authenticated' || permsLoading) return
    let cancel = false
    const propio = () => fetch(`/api/postgres/guias/by-email/${encodeURIComponent(email)}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null)).then(j => j?.advisor?._id || null).catch(() => null)
    ;(async () => {
      if (esGuia || !verTodos) {
        const id = await propio()
        if (cancel) return
        if (!id) { setError('Tu usuario no está registrado como guía.'); setCargando(false); return }
        setGuiaId(id)
        return
      }
      const lista: GuiaOpcion[] = await fetch('/api/postgres/guias', { cache: 'no-store' })
        .then(r => r.json()).then(j => j.guias || []).catch(() => [])
      if (cancel) return
      setGuias(lista)
      const id = guiaParam || lista[0]?._id || null
      if (!id) { setError('No hay guías para mostrar.'); setCargando(false); return }
      setGuiaId(id)
    })()
    return () => { cancel = true }
  }, [status, permsLoading, esGuia, verTodos, email, guiaParam])

  // 2. Cargar el panel del guía.
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

  // El curso elegido: el de la URL si es de este guía; si no, el primero.
  const curso: CursoResumenGuia | null = useMemo(() => {
    const cs = data?.cursos || []
    return cs.find(c => c.cursoId === cursoSel) || cs[0] || null
  }, [data, cursoSel])

  const cambiarGuia = (id: string) => {
    setCursoSel('')
    setGuiaId(id)
    router.replace(`/panel-advisor/alumnos?guia=${encodeURIComponent(id)}`)
  }

  const exportar = () => {
    if (!curso) return
    exportToExcel(curso.filas, columnasCsvPanelGuia(curso), nombreArchivoCsv(curso), { separator: ';' })
  }

  return (
    <div className="min-h-screen bg-[#F3F5F8]">
      <div className="mx-auto max-w-[1360px] px-4 sm:px-6 py-6">
        <Link href="/panel-advisor" className="inline-flex min-h-[44px] items-center text-sm text-primary-600 hover:underline">← Panel del guía</Link>

        <header className="mt-1 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-widest text-primary-600 uppercase">MOSAICO · Panel del guía</p>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#17212B]">Mis alumnos por curso</h1>
            <p className="text-sm text-[#556270]">
              {data?.guia.nombre || '—'}{data ? ` · Corte al ${fmtCorte(data.corte)}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {verTodos && guias.length > 0 && (
              <select aria-label="Guía" value={guiaId || ''} onChange={e => cambiarGuia(e.target.value)}
                className="min-h-[44px] rounded-[14px] border border-[#E1E6EC] bg-white px-3 text-sm text-[#17212B]">
                {guias.map(g => <option key={g._id} value={g._id}>{g.nombreCompleto || g.email}</option>)}
              </select>
            )}
            <button type="button" onClick={exportar} disabled={!curso || curso.filas.length === 0}
              className="min-h-[44px] rounded-[14px] border border-[#E1E6EC] bg-white px-5 text-sm font-medium text-[#17212B] hover:border-primary-300 disabled:opacity-50">
              Exportar CSV
            </button>
          </div>
        </header>

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
          <PanelAlumnosVista cursos={data.cursos} cursoActivo={curso} onElegirCurso={setCursoSel} />
        )}
      </div>
    </div>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">Cargando…</div>}>
      <PanelAlumnos />
    </Suspense>
  )
}
