'use client'

import { useEffect, useState } from 'react'
import {
  ArrowDownTrayIcon,
  BookOpenIcon,
  GlobeAltIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline'

const INTERACTIVE_MATERIAL_URLS: Record<string, string> = {
  'BN1': 'https://www.lgsplataforma.com/material-bn1',
  'BN2': 'https://www.lgsplataforma.com/material-bn2',
  'BN3': 'https://www.lgsplataforma.com/material-bn3',
  'P1':  'https://www.lgsplataforma.com/material-p1',
  'P2':  'https://www.lgsplataforma.com/material-p2',
  'P3':  'https://www.lgsplataforma.com/material-p3',
  'F1':  'https://www.lgsplataforma.com/material-f1',
  'F2':  'https://www.lgsplataforma.com/material-f2',
  'F3':  'https://www.lgsplataforma.com/material-f3',
}

function normalizeNivelCode(nivel: string): string {
  return (nivel || '').replace(/\s*JUMP\s*/i, '').trim().toUpperCase()
}

function getInteractiveMaterialUrl(nivel: string): string | null {
  return INTERACTIVE_MATERIAL_URLS[normalizeNivelCode(nivel)] || null
}

interface MaterialsListProps {
  data: any
  isLoading: boolean
}

export default function MaterialsList({ data, isLoading }: MaterialsListProps) {
  const materials = data?.materials || []
  const nivel = data?.nivel || ''
  const nivelNormalizado = normalizeNivelCode(nivel)

  // Feature flag check: ¿está disponible el visor v2 (LGS) para este nivel?
  // Solo mostramos el botón nuevo si el endpoint confirma available=true.
  const [v2Available, setV2Available] = useState(false)
  useEffect(() => {
    if (!nivelNormalizado) return
    let cancelled = false
    fetch(`/api/postgres/libros-interactivos/${encodeURIComponent(nivelNormalizado)}`)
      .then(r => r.json())
      .then(j => { if (!cancelled) setV2Available(Boolean(j?.available)) })
      .catch(() => { if (!cancelled) setV2Available(false) })
    return () => { cancelled = true }
  }, [nivelNormalizado])

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-32 mb-4" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 bg-gray-100 rounded-lg mb-2" />
        ))}
      </div>
    )
  }

  // Collect all material items from all steps
  const allMaterials: { name: string; url: string; step: string }[] = []
  const seen = new Set<string>()

  for (const row of materials) {
    // Only materialUsuario: DO Spaces keys like "materials/..."
    const userMats = row.materialUsuario || []
    if (Array.isArray(userMats)) {
      for (const key of userMats) {
        if (typeof key === 'string' && key.startsWith('materials/') && !seen.has(key)) {
          seen.add(key)
          const filename = decodeURIComponent(key.split('/').pop() || key)
          allMaterials.push({
            name: filename.replace(/\.pdf$/i, ''),
            url: `/api/postgres/niveles/material?key=${encodeURIComponent(key)}`,
            step: row.step || '',
          })
        }
      }
    }
  }

  const classicUrl = getInteractiveMaterialUrl(nivel)

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
        Material - {nivel}
      </h3>

      {/* v2 (LGS) — solo si el flag global está ON y el nivel tiene libro configurado */}
      {v2Available && (
        <a
          href={`/panel-estudiante/material-interactivo/${encodeURIComponent(nivelNormalizado)}`}
          className="flex items-center gap-3 p-3 mb-3 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors group border border-emerald-200"
        >
          <div className="flex-shrink-0 w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center group-hover:bg-emerald-200">
            <SparklesIcon className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-emerald-900">Material Interactivo</p>
            <p className="text-xs text-emerald-600">{nivelNormalizado} — nueva versión</p>
          </div>
        </a>
      )}

      {/* Wix (clásico) — sigue mientras dure la coexistencia */}
      {classicUrl && (
        <a
          href={classicUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-3 mb-3 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors group border border-indigo-200"
        >
          <div className="flex-shrink-0 w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center group-hover:bg-indigo-200">
            <GlobeAltIcon className="h-5 w-5 text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-indigo-900">
              {v2Available ? 'Material Interactivo (clásico)' : 'Material Interactivo'}
            </p>
            <p className="text-xs text-indigo-500">{nivel}</p>
          </div>
        </a>
      )}

      {allMaterials.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <BookOpenIcon className="h-10 w-10 mx-auto mb-2 text-gray-300" />
          <p className="text-sm">No hay material disponible para tu nivel</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {allMaterials.map((mat, idx) => (
            <a
              key={idx}
              href={mat.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-primary-50 transition-colors group"
            >
              <div className="flex-shrink-0 w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center group-hover:bg-primary-200">
                <ArrowDownTrayIcon className="h-5 w-5 text-primary-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{mat.name}</p>
                <p className="text-xs text-gray-500">{mat.step}</p>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
