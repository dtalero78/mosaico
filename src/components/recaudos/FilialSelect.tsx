'use client'

import { useEffect, useState } from 'react'
import { api } from '@/hooks/use-api'
import { SIN_FILIAL } from '@/lib/filial-filtro'

export default function FilialSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [filiales, setFiliales] = useState<string[]>([])
  useEffect(() => {
    api.get<{ filiales: string[] }>('/api/postgres/recaudos/filiales').then(d => setFiliales(d.filiales || [])).catch(() => {})
  }, [])
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-700">Filial</label>
      <select id={id} value={value} onChange={e => onChange(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
        <option value="">Todas</option>
        {filiales.map(f => (<option key={f} value={f}>{f}</option>))}
        <option value={SIN_FILIAL}>(Sin filial)</option>
      </select>
    </div>
  )
}
