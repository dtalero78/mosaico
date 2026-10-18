'use client'

/**
 * Panel del guía › "Mis alumnos por curso" (/panel-advisor/alumnos).
 *
 * Se abre en otra pestaña desde Panel Guía › Cursos asignados (clic en el nombre
 * del curso): `?guia=<GUIAS._id>&curso=<CURSOS_CAMPAIGN._id>`. Página completa,
 * sin menú lateral: la tabla necesita el ancho. La misma vista está también como
 * pestaña "Mis alumnos" del Panel Guía (componente `PanelAlumnosGuia`).
 *
 * Quién ve qué lo decide el endpoint; aquí sólo se elige qué pedir:
 *  - rol GUIA → siempre su propio panel (resuelto por su correo; `?guia=` se ignora);
 *  - con "ver todos" → el `?guia=` pedido o el primero de la lista, con selector;
 *  - el resto → su propio panel si tiene ficha de guía.
 */
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { usePermissions } from '@/hooks/usePermissions'
import { AcademicoPermission } from '@/types/permissions'
import PanelAlumnosGuia from '@/components/panel-guia/PanelAlumnosGuia'
import { EsqueletoPanel } from '@/components/panel-guia/PanelAlumnosVista'

type GuiaOpcion = { _id: string; nombreCompleto?: string | null; email?: string | null }

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
  const [error, setError] = useState<string | null>(null)

  // Qué guía pedir.
  useEffect(() => {
    if (status !== 'authenticated' || permsLoading) return
    let cancel = false
    const propio = () => fetch(`/api/postgres/guias/by-email/${encodeURIComponent(email)}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null)).then(j => j?.advisor?._id || null).catch(() => null)
    ;(async () => {
      if (esGuia || !verTodos) {
        const id = await propio()
        if (cancel) return
        if (!id) { setError('Tu usuario no está registrado como guía.'); return }
        setGuiaId(id)
        return
      }
      // Sólo guías activos con algún curso vigente: los demás no tienen alumnos que mostrar.
      const lista: GuiaOpcion[] = await fetch('/api/postgres/guias?conCursosVigentes=1', { cache: 'no-store' })
        .then(r => r.json()).then(j => j.guias || []).catch(() => [])
      if (cancel) return
      setGuias(lista)
      const id = guiaParam || lista[0]?._id || null
      if (!id) { setError('No hay guías para mostrar.'); return }
      setGuiaId(id)
    })()
    return () => { cancel = true }
  }, [status, permsLoading, esGuia, verTodos, email, guiaParam])

  const cambiarGuia = (id: string) => {
    setGuiaId(id)
    router.replace(`/panel-advisor/alumnos?guia=${encodeURIComponent(id)}`)
  }

  const selector = verTodos && guias.length > 0 ? (
    <select aria-label="Guía" value={guiaId || ''} onChange={e => cambiarGuia(e.target.value)}
      className="min-h-[44px] rounded-[14px] border border-[#E1E6EC] bg-white px-3 text-sm text-[#17212B]">
      {guias.map(g => <option key={g._id} value={g._id}>{g.nombreCompleto || g.email}</option>)}
    </select>
  ) : null

  return (
    <div className="min-h-screen bg-[#F3F5F8]">
      <div className="mx-auto max-w-[1360px] px-4 sm:px-6 py-6">
        <Link href="/panel-advisor" className="inline-flex min-h-[44px] items-center text-sm text-primary-600 hover:underline">← Panel del guía</Link>
        {error ? (
          <div role="alert" className="mt-6 rounded-[14px] border border-[#F5C2BC] bg-[#FDECEA] p-4 text-sm text-[#9A1B12]">{error}</div>
        ) : !guiaId ? (
          <EsqueletoPanel />
        ) : (
          // `key`: al cambiar de guía se arranca limpio. Un `?curso=` que no sea de
          // este guía no rompe nada: se cae al primer curso.
          <PanelAlumnosGuia key={guiaId} guiaId={guiaId} cursoInicial={cursoParam} acciones={selector} />
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
