'use client'

import { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { MantenimientoPermission } from '@/types/permissions'
import {
  ArrowLeftIcon, MagnifyingGlassIcon, CheckCircleIcon,
  ExclamationTriangleIcon, ClipboardIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

interface CursoRow { campaign: string; tipoCurso: string; horarioCurso: string }

export default function CrearEstudiantePage() {
  const [numeroId, setNumeroId] = useState('')
  const [searching, setSearching] = useState(false)
  const [preview, setPreview] = useState<any>(null)
  const [result, setResult] = useState<{ nombre: string; userLogin: string; clave: string } | null>(null)

  // Campos de perfil (editables sobre lo detectado)
  const [email, setEmail] = useState('')
  const [celular, setCelular] = useState('')
  const [domicilio, setDomicilio] = useState('')
  const [ciudad, setCiudad] = useState('')
  const [fechaNacimiento, setFechaNacimiento] = useState('')
  const [clave, setClave] = useState('')

  // Selección de campaña/curso/horario
  const [cursos, setCursos] = useState<CursoRow[]>([])
  const [campaign, setCampaign] = useState('')
  const [tipoCurso, setTipoCurso] = useState('')
  const [horarioCurso, setHorarioCurso] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetch('/api/postgres/cursos-campaign', { cache: 'no-store' })
      .then(r => r.json()).then(d => setCursos(d.rows || [])).catch(() => {})
  }, [])

  const campaigns = useMemo(() => Array.from(new Set(cursos.map(c => c.campaign))), [cursos])
  const tipos = useMemo(() => Array.from(new Set(cursos.filter(c => c.campaign === campaign).map(c => c.tipoCurso))), [cursos, campaign])
  const horarios = useMemo(() => cursos.filter(c => c.campaign === campaign && c.tipoCurso === tipoCurso).map(c => c.horarioCurso), [cursos, campaign, tipoCurso])

  const buscar = async () => {
    if (!numeroId.trim()) return
    setSearching(true); setPreview(null); setResult(null)
    try {
      const r = await fetch(`/api/admin/crear-estudiante?numeroId=${encodeURIComponent(numeroId.trim())}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Error')
      setPreview(j)
      if (j.persona) {
        setEmail(j.persona.email || ''); setCelular(j.persona.celular || '')
        setDomicilio(j.persona.domicilio || ''); setCiudad(j.persona.ciudad || '')
        setFechaNacimiento((j.persona.fechaNacimiento || '').slice(0, 10))
        setCampaign(j.persona.campaign || ''); setTipoCurso(j.persona.tipoCurso || ''); setHorarioCurso(j.persona.horarioCurso || '')
      }
    } catch (e: any) { toast.error(e.message) } finally { setSearching(false) }
  }

  const crear = async () => {
    setCreating(true)
    try {
      const r = await fetch('/api/admin/crear-estudiante', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numeroId: numeroId.trim(), email, celular, domicilio, ciudad, fechaNacimiento, campaign, tipoCurso, horarioCurso, clave: clave || undefined }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || j?.message || 'Error al crear')
      setResult({ nombre: j.nombre, userLogin: j.userLogin, clave: j.clave })
      toast.success('Estudiante creado')
    } catch (e: any) { toast.error(e.message) } finally { setCreating(false) }
  }

  const canCreate = preview?.canCreate && campaign && tipoCurso && horarioCurso && !creating

  return (
    <DashboardLayout>
      <PermissionGuard permission={MantenimientoPermission.CREAR_ROL} showDefaultMessage>
        <div className="p-6 max-w-lg mx-auto">
          <button type="button" onClick={() => history.back()}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4">
            <ArrowLeftIcon className="w-4 h-4" /> Volver
          </button>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Crear Estudiante</h1>
          <p className="text-gray-500 mb-6">Login para un beneficiario ya vinculado a un contrato. Se crea en ACADEMICA (puente WELCOME) + login activo por userLogin.</p>

          {result ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6">
              <CheckCircleIcon className="w-10 h-10 text-emerald-600 mb-3" />
              <h2 className="text-lg font-semibold text-emerald-800">Estudiante creado</h2>
              <p className="text-sm text-emerald-700 mt-1">{result.nombre}</p>
              <div className="mt-4 space-y-2">
                <div className="p-3 bg-white rounded-lg border border-emerald-200">
                  <div className="text-xs text-gray-500 mb-1">Usuario (userLogin)</div>
                  <code className="text-lg font-mono font-bold text-gray-900">{result.userLogin}</code>
                </div>
                <div className="p-3 bg-white rounded-lg border border-emerald-200">
                  <div className="text-xs text-gray-500 mb-1">Clave (compártela, no se vuelve a mostrar)</div>
                  <div className="flex items-center gap-2">
                    <code className="text-lg font-mono font-bold text-gray-900">{result.clave}</code>
                    <button type="button" onClick={() => { navigator.clipboard.writeText(result.clave); toast.success('Clave copiada') }}
                      className="p-1.5 text-gray-400 hover:text-gray-600" title="Copiar"><ClipboardIcon className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => { setResult(null); setPreview(null); setNumeroId('') }}
                className="mt-5 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">Crear otro</button>
            </div>
          ) : (
            <>
              {/* Búsqueda */}
              <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
                <label className="block text-xs font-medium text-gray-500 mb-1">Número de ID</label>
                <div className="flex gap-2">
                  <input value={numeroId} onChange={e => setNumeroId(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                    onKeyDown={e => { if (e.key === 'Enter') buscar() }}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Ej. 1010108675" />
                  <button type="button" onClick={buscar} disabled={searching || !numeroId.trim()}
                    className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1">
                    <MagnifyingGlassIcon className="w-4 h-4" /> {searching ? '...' : 'Buscar'}
                  </button>
                </div>
              </div>

              {preview && !preview.found && (
                <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">{preview.message}</div>
              )}

              {preview?.found && !preview.canCreate && (
                <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2">
                  <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-amber-800">
                    <div className="font-medium">{preview.persona?.primerNombre} {preview.persona?.primerApellido}</div>
                    {preview.message}
                  </div>
                </div>
              )}

              {preview?.found && preview.canCreate && (
                <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
                  <div className="text-sm">
                    <span className="font-semibold text-gray-900">{preview.persona.primerNombre} {preview.persona.primerApellido}</span>
                    <span className="text-gray-400"> · {preview.persona.numeroId} · Contrato {preview.persona.contrato}</span>
                    {preview.academicaExists && <span className="ml-2 text-[11px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">ya tiene ACADEMICA</span>}
                  </div>

                  {/* Perfil */}
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-xs text-gray-500 mb-1">Correo</label>
                      <input value={email} onChange={e => setEmail(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
                    <div><label className="block text-xs text-gray-500 mb-1">Celular</label>
                      <input value={celular} onChange={e => setCelular(e.target.value.replace(/[^\d]/g, ''))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
                    <div><label className="block text-xs text-gray-500 mb-1">Domicilio</label>
                      <input value={domicilio} onChange={e => setDomicilio(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
                    <div><label className="block text-xs text-gray-500 mb-1">Ciudad</label>
                      <input value={ciudad} onChange={e => setCiudad(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
                    <div><label className="block text-xs text-gray-500 mb-1">Fecha nacimiento</label>
                      <input type="date" value={fechaNacimiento} onChange={e => setFechaNacimiento(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
                    <div><label className="block text-xs text-gray-500 mb-1">Clave (opcional, si no se genera)</label>
                      <input value={clave} onChange={e => setClave(e.target.value)} placeholder="auto" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
                  </div>

                  {/* Campaña / curso / horario */}
                  <div className="border-t border-gray-100 pt-3">
                    <div className="text-xs font-medium text-gray-500 mb-2">Campaña / Curso / Horario *</div>
                    <div className="grid grid-cols-3 gap-2">
                      <select value={campaign} onChange={e => { setCampaign(e.target.value); setTipoCurso(''); setHorarioCurso('') }}
                        className="px-2 py-2 border border-gray-300 rounded-lg text-sm">
                        <option value="">Campaña</option>
                        {campaigns.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <select value={tipoCurso} onChange={e => { setTipoCurso(e.target.value); setHorarioCurso('') }} disabled={!campaign}
                        className="px-2 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100">
                        <option value="">Curso</option>
                        {tipos.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <select value={horarioCurso} onChange={e => setHorarioCurso(e.target.value)} disabled={!tipoCurso}
                        className="px-2 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100">
                        <option value="">Horario</option>
                        {horarios.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  </div>

                  <button type="button" onClick={crear} disabled={!canCreate}
                    className="w-full py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
                    {creating ? 'Creando…' : 'Crear Estudiante'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
