'use client'

import { useState, useCallback, useRef } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { AcademicoPermission } from '@/types/permissions'

interface Leccion {
  fila: number
  curso: string
  modulo: string
  descripcionModulo: string
  leccion: string
  descripcion: string
  clubs: string[]
  contenido: string
  esParalelo: boolean
  orden?: number
}

type TextField = 'curso' | 'modulo' | 'descripcionModulo' | 'leccion' | 'descripcion'

// Aliases flexibles de columnas (encabezado del CSV → campo interno). Acepta tanto
// el formato simple (modulo/leccion/…) como los nombres nativos de NIVELES
// (code/step/description/descripcionModulo) para poder re-subir un export completo.
const COL_ALIASES: Record<string, TextField> = {
  curso: 'curso',
  modulo: 'modulo',
  'módulo': 'modulo',
  code: 'modulo',
  descipcionmodulo: 'descripcionModulo',
  descripcionmodulo: 'descripcionModulo',
  'descripción módulo': 'descripcionModulo',
  'descripcion modulo': 'descripcionModulo',
  leccion: 'leccion',
  'lección': 'leccion',
  step: 'leccion',
  descripcionlession: 'descripcion',
  descripcionleccion: 'descripcion',
  'descripción lección': 'descripcion',
  'descripcion leccion': 'descripcion',
  descripcion: 'descripcion',
  description: 'descripcion',
}

// Orden posicional por defecto cuando el CSV no trae encabezado reconocible.
const POS_ORDER: TextField[] = ['curso', 'modulo', 'descripcionModulo', 'leccion', 'descripcion']

function detectSep(line: string): string {
  const semi = (line.match(/;/g) || []).length
  const comma = (line.match(/,/g) || []).length
  return semi >= comma ? ';' : ','
}

// Decodifica bytes tolerando codificación MIXTA UTF-8 / Latin-1 (los CSV de los
// cursos vienen así). Cada secuencia UTF-8 válida se decodifica como UTF-8; los
// bytes sueltos ≥0x80 se interpretan como Latin-1. Réplica de smartDecode() de
// scripts/seed-niveles-curso.js — evita el mojibake "Lecci�n" → "Lección".
function smartDecode(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8')
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]
    if (b < 0x80) { out += String.fromCharCode(b); i++; continue }
    let len = 0
    if ((b & 0xe0) === 0xc0) len = 2
    else if ((b & 0xf0) === 0xe0) len = 3
    else if ((b & 0xf8) === 0xf0) len = 4
    if (len && i + len <= bytes.length) {
      let ok = true
      for (let k = 1; k < len; k++) if ((bytes[i + k] & 0xc0) !== 0x80) { ok = false; break }
      if (ok) { out += utf8.decode(bytes.subarray(i, i + len)); i += len; continue }
    }
    out += String.fromCharCode(b) // Latin-1
    i++
  }
  return out
}

// Parser de línea CSV con comillas dobles ("" = comilla escapada). Necesario para
// campos como clubs = "[""BASICO - Leccion 00"",""AVANZADO - Leccion 00""]".
function parseCsvLine(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ }
        else inQ = false
      } else cur += ch
    } else {
      if (ch === '"') inQ = true
      else if (ch === sep) { out.push(cur); cur = '' }
      else cur += ch
    }
  }
  out.push(cur)
  return out
}

function parseCSV(text: string): { rows: Leccion[]; error: string | null } {
  const clean = text.replace(/^﻿/, '') // quita BOM
  const lines = clean.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length === 0) return { rows: [], error: 'El archivo está vacío.' }

  const sep = detectSep(lines[0])
  const firstCols = parseCsvLine(lines[0], sep).map(c => c.trim().toLowerCase())

  // ¿Primera fila es encabezado? (contiene "curso" y "modulo"/"módulo"/"code")
  const hasHeader = firstCols.includes('curso') &&
    (firstCols.includes('modulo') || firstCols.includes('módulo') || firstCols.includes('code'))

  // Índice de columnas nativas extra (solo cuando hay encabezado).
  const nameIdx: Record<string, number> = {}
  if (hasHeader) firstCols.forEach((c, i) => { if (!(c in nameIdx)) nameIdx[c] = i })

  const colMap: (TextField | null)[] = hasHeader
    ? firstCols.map(c => COL_ALIASES[c] || null)
    : POS_ORDER

  const dataLines = hasHeader ? lines.slice(1) : lines
  const rows: Leccion[] = []
  dataLines.forEach((line, i) => {
    const parts = parseCsvLine(line, sep)
    if (parts.every(p => !p.trim())) return
    const row: Leccion = {
      fila: i + 1, curso: '', modulo: '', descripcionModulo: '', leccion: '', descripcion: '',
      clubs: [], contenido: '', esParalelo: false,
    }
    colMap.forEach((field, idx) => {
      if (!field) return
      let val = (parts[idx] ?? '').trim()
      if (field === 'descripcion' && idx === colMap.length - 1 && parts.length > colMap.length) {
        val = parts.slice(idx).join(sep).trim()
      }
      row[field] = val.replace(/[}\s]+$/, '').trim()
    })
    // Columnas nativas extra del export (clubs / contenido / esParalelo / orden).
    if (hasHeader) {
      if (nameIdx.clubs != null) {
        const raw = (parts[nameIdx.clubs] ?? '').trim()
        if (raw) { try { const c = JSON.parse(raw); if (Array.isArray(c)) row.clubs = c.map((x: any) => String(x)) } catch { /* ignora */ } }
      }
      if (nameIdx.contenido != null) row.contenido = (parts[nameIdx.contenido] ?? '').trim()
      if (nameIdx.orden != null) { const n = parseInt((parts[nameIdx.orden] ?? '').trim(), 10); if (!isNaN(n)) row.orden = n }
      if (nameIdx.esparalelo != null) {
        const v = (parts[nameIdx.esparalelo] ?? '').trim().toLowerCase()
        row.esParalelo = v === 'verdadero' || v === 'true' || v === 't' || v === '1'
      }
    }
    rows.push(row)
  })

  const cursos = new Set(rows.map(r => r.curso).filter(Boolean))
  if (cursos.size === 0) return { rows, error: 'No se detectó ninguna columna "curso".' }
  if (cursos.size > 1) return { rows, error: `El CSV mezcla varios cursos (${Array.from(cursos).join(', ')}). Sube un solo curso por archivo.` }

  return { rows, error: null }
}

export default function SubirCursoPage() {
  const [rows, setRows] = useState<Leccion[]>([])
  const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [existentes, setExistentes] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const curso = rows.find(r => r.curso)?.curso || ''

  const handleFile = useCallback((file: File) => {
    setResult(null)
    setExistentes(null)
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = e => {
      const buf = e.target?.result as ArrayBuffer
      const text = smartDecode(new Uint8Array(buf))
      const { rows: parsed, error } = parseCSV(text)
      setRows(parsed)
      setParseError(error)
    }
    reader.readAsArrayBuffer(file)
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const updateCell = (fila: number, field: TextField, value: string) => {
    setRows(prev => prev.map(r => (r.fila === fila ? { ...r, [field]: value } : r)))
  }

  const invalidRows = rows.filter(r => !r.modulo.trim() || !r.leccion.trim())

  const buildPayload = (apply: boolean) => ({
    curso,
    apply,
    rows: rows.map(r => ({
      modulo: r.modulo,
      descripcionModulo: r.descripcionModulo,
      leccion: r.leccion,
      descripcion: r.descripcion,
      clubs: r.clubs,
      contenido: r.contenido,
      esParalelo: r.esParalelo,
      orden: r.orden,
    })),
  })

  const openConfirm = async () => {
    setResult(null)
    try {
      const res = await fetch('/api/postgres/niveles/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(false)),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error || j?.message || 'Error al validar')
      setExistentes(j.existentes ?? 0)
      setConfirmOpen(true)
    } catch (err: any) {
      setResult({ ok: false, msg: err.message })
    }
  }

  const apply = async () => {
    setApplying(true)
    setResult(null)
    try {
      const res = await fetch('/api/postgres/niveles/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(true)),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error || j?.message || 'Error al importar')
      setConfirmOpen(false)
      setResult({ ok: true, msg: `Curso ${j.curso} guardado: ${j.total} lecciones${j.reemplazadas ? ` (reemplazó ${j.reemplazadas} previas)` : ''}.` })
      setRows([])
      setFileName('')
    } catch (err: any) {
      setResult({ ok: false, msg: err.message })
    } finally {
      setApplying(false)
    }
  }

  const modulos = Array.from(new Set(rows.map(r => r.modulo).filter(Boolean)))

  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.ACTUALIZAR_MATERIAL} showDefaultMessage>
        <div className="p-6 max-w-6xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Subir Curso</h1>
            <p className="text-gray-500 mt-1">
              Crea o reemplaza los módulos y lecciones de un curso en <code>NIVELES</code> desde un CSV.
              El archivo debe contener un <b>solo curso</b>. Al aplicar se <b>reemplazan</b> todas las lecciones existentes de ese curso.
            </p>
            <p className="text-xs text-gray-400 mt-2">
              Columnas: <code>curso ; modulo ; descipcionmodulo ; leccion ; descripcionlession</code> (separador <code>;</code> o <code>,</code>, con o sin encabezado).
            </p>
          </div>

          {/* Dropzone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
              dragOver ? 'border-rose-500 bg-rose-50' : 'border-gray-300 hover:border-rose-400 bg-white'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
            <svg className="w-10 h-10 text-gray-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p className="text-gray-700 font-medium">{fileName || 'Arrastra el CSV aquí o haz clic para seleccionar'}</p>
            {fileName && <p className="text-xs text-gray-400 mt-1">{rows.length} filas leídas</p>}
          </div>

          {parseError && (
            <div className="mt-4 p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{parseError}</div>
          )}

          {result && (
            <div className={`mt-4 p-4 rounded-lg border text-sm ${result.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
              {result.msg}
            </div>
          )}

          {rows.length > 0 && !parseError && (
            <>
              {/* Resumen */}
              <div className="mt-6 flex flex-wrap gap-3 items-center">
                <span className="px-3 py-1 rounded-full bg-rose-100 text-rose-700 text-sm font-semibold">Curso: {curso}</span>
                <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-sm">{rows.length} lecciones</span>
                <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-sm">{modulos.length} módulos</span>
                {rows.some(r => r.clubs.length > 0) && (
                  <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-sm">
                    {rows.filter(r => r.clubs.length > 0).length} con talleres
                  </span>
                )}
                {invalidRows.length > 0 && (
                  <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-sm">
                    {invalidRows.length} fila(s) sin módulo/lección
                  </span>
                )}
              </div>

              {/* Preview editable */}
              <div className="mt-4 border border-gray-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto max-h-[26rem] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0 z-10">
                      <tr className="text-left text-gray-500">
                        <th className="px-3 py-2 font-medium w-10">#</th>
                        <th className="px-3 py-2 font-medium">Módulo</th>
                        <th className="px-3 py-2 font-medium">Descripción módulo</th>
                        <th className="px-3 py-2 font-medium">Lección</th>
                        <th className="px-3 py-2 font-medium">Descripción lección</th>
                        <th className="px-3 py-2 font-medium">Talleres</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.map(r => {
                        const bad = !r.modulo.trim() || !r.leccion.trim()
                        return (
                          <tr key={r.fila} className={bad ? 'bg-amber-50' : ''}>
                            <td className="px-3 py-1.5 text-gray-400">{r.fila}</td>
                            <td className="px-2 py-1">
                              <input value={r.modulo} onChange={e => updateCell(r.fila, 'modulo', e.target.value)}
                                className={`w-full px-2 py-1 rounded border ${!r.modulo.trim() ? 'border-amber-400' : 'border-gray-200'} focus:border-rose-400 focus:outline-none`} />
                            </td>
                            <td className="px-2 py-1">
                              <input value={r.descripcionModulo} onChange={e => updateCell(r.fila, 'descripcionModulo', e.target.value)}
                                className="w-full px-2 py-1 rounded border border-gray-200 focus:border-rose-400 focus:outline-none" />
                            </td>
                            <td className="px-2 py-1">
                              <input value={r.leccion} onChange={e => updateCell(r.fila, 'leccion', e.target.value)}
                                className={`w-full px-2 py-1 rounded border ${!r.leccion.trim() ? 'border-amber-400' : 'border-gray-200'} focus:border-rose-400 focus:outline-none`} />
                            </td>
                            <td className="px-2 py-1">
                              <input value={r.descripcion} onChange={e => updateCell(r.fila, 'descripcion', e.target.value)}
                                className="w-full px-2 py-1 rounded border border-gray-200 focus:border-rose-400 focus:outline-none" />
                            </td>
                            <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap" title={r.clubs.join(', ')}>
                              {r.clubs.length > 0 ? `${r.clubs.length} taller(es)` : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-4 flex justify-end gap-3">
                <button type="button" onClick={() => { setRows([]); setFileName(''); setResult(null) }}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
                  Descartar
                </button>
                <button type="button" onClick={openConfirm} disabled={invalidRows.length > 0}
                  className="px-4 py-2 rounded-lg bg-rose-600 text-white font-medium hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed">
                  Guardar curso
                </button>
              </div>
            </>
          )}

          {/* Modal de confirmación */}
          {confirmOpen && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-2">Confirmar importación</h3>
                <p className="text-sm text-gray-600">
                  Vas a guardar el curso <b>{curso}</b> con <b>{rows.length} lecciones</b> en {modulos.length} módulos.
                </p>
                {existentes != null && existentes > 0 && (
                  <p className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
                    ⚠️ El curso ya tiene <b>{existentes} lecciones</b> registradas. Se <b>reemplazarán</b> por completo por las de este archivo.
                  </p>
                )}
                <div className="mt-6 flex justify-end gap-3">
                  <button type="button" onClick={() => setConfirmOpen(false)} disabled={applying}
                    className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
                    Cancelar
                  </button>
                  <button type="button" onClick={apply} disabled={applying}
                    className="px-4 py-2 rounded-lg bg-rose-600 text-white font-medium hover:bg-rose-700 disabled:opacity-50">
                    {applying ? 'Guardando…' : 'Confirmar y guardar'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
