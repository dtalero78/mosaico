'use client'

import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { HORAS_NIVELACION } from '@/lib/nivelacion-confirmacion'

interface Guia { _id: string; nombreCompleto: string }
interface Salon { salon: string; campaign: string; horarioCurso: string }
interface Alumno { academicaId: string; numeroId: string; contrato: string; nombre: string }
interface Leccion { value: string; modulo: string }

/**
 * "Adicionar Nivelación" desde Servicio — el gemelo del alta de Casos de
 * Atención, con la MISMA cascada **Guía → Curso → Salón → Usuario** (comparte su
 * endpoint de opciones) y dos pasos más: **Módulo → Lección**, porque una
 * nivelación se pide sobre un punto concreto del curso.
 *
 * Se elige el guía primero y no el alumno porque es lo que ata la nivelación a
 * una clase real: el servidor comprueba que ese guía dicte el salón del alumno.
 */
export default function AdicionarNivelacionModal({ onClose, onCreated }: {
  onClose: () => void
  onCreated: () => void
}) {
  const [guias, setGuias] = useState<Guia[]>([])
  const [cursos, setCursos] = useState<string[]>([])
  const [salones, setSalones] = useState<Salon[]>([])
  const [alumnos, setAlumnos] = useState<Alumno[]>([])
  const [lecciones, setLecciones] = useState<Leccion[]>([])

  const [guiaId, setGuiaId] = useState('')
  const [curso, setCurso] = useState('')
  const [salonKey, setSalonKey] = useState('')   // índice dentro de `salones`
  const [academicaId, setAcademicaId] = useState('')
  const [modulo, setModulo] = useState('')
  const [leccion, setLeccion] = useState('')
  const [hora, setHora] = useState('')
  const [motivo, setMotivo] = useState('')

  const [cargando, setCargando] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const opciones = (qs: string) =>
    fetch(`/api/postgres/casos-atencion/alta-opciones?${qs}`, { cache: 'no-store' }).then(r => r.json())

  useEffect(() => {
    setCargando(true)
    opciones('').then(d => setGuias(d.guias || [])).catch(() => toast.error('No se pudieron cargar los guías'))
      .finally(() => setCargando(false))
  }, [])

  // Cada paso limpia lo que cuelga de él: un salón de otro curso no significa nada.
  const elegirGuia = async (id: string) => {
    setGuiaId(id); setCurso(''); setSalonKey(''); setAcademicaId('')
    setModulo(''); setLeccion(''); setCursos([]); setSalones([]); setAlumnos([]); setLecciones([])
    if (!id) return
    setCargando(true)
    try { setCursos((await opciones(`guiaId=${encodeURIComponent(id)}`)).cursos || []) }
    finally { setCargando(false) }
  }

  const elegirCurso = async (c: string) => {
    setCurso(c); setSalonKey(''); setAcademicaId('')
    setModulo(''); setLeccion(''); setSalones([]); setAlumnos([]); setLecciones([])
    if (!c) return
    setCargando(true)
    try {
      const [s, n] = await Promise.all([
        opciones(`guiaId=${encodeURIComponent(guiaId)}&curso=${encodeURIComponent(c)}`),
        fetch(`/api/postgres/niveles?curso=${encodeURIComponent(c)}`, { cache: 'no-store' }).then(r => r.json()),
      ])
      setSalones(s.salones || [])
      const ls: Leccion[] = []
      ;(n.modulos || []).forEach((m: any) => (m.steps || []).forEach((st: string) => ls.push({ value: st, modulo: m.code })))
      setLecciones(ls)
    } finally { setCargando(false) }
  }

  const elegirSalon = async (k: string) => {
    setSalonKey(k); setAcademicaId(''); setAlumnos([])
    if (!k) return
    const s = salones[Number(k)]
    if (!s) return
    setCargando(true)
    try {
      const d = await opciones(
        `guiaId=${encodeURIComponent(guiaId)}&curso=${encodeURIComponent(curso)}` +
        `&salon=${encodeURIComponent(s.salon)}&campaign=${encodeURIComponent(s.campaign)}` +
        `&horarioCurso=${encodeURIComponent(s.horarioCurso)}`
      )
      setAlumnos(d.alumnos || [])
    } finally { setCargando(false) }
  }

  const modulos: string[] = []
  for (const l of lecciones) if (!modulos.includes(l.modulo)) modulos.push(l.modulo)
  const leccionesModulo = modulo ? lecciones.filter(l => l.modulo === modulo) : lecciones

  const listo = !!(guiaId && curso && salonKey && academicaId && leccion && hora && motivo.trim())

  const crear = async () => {
    if (!listo) return
    setGuardando(true)
    try {
      const r = await fetch('/api/postgres/reports/servicio/nivelaciones/alta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ academicaId, guiaId, modulo, leccion, hora, motivo: motivo.trim() }),
      }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      toast.success(`Nivelación adicionada para ${r.nombre}`)
      onCreated()
      onClose()
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo adicionar la nivelación')
    } finally { setGuardando(false) }
  }

  const alumno = alumnos.find(a => a.academicaId === academicaId)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Adicionar Nivelación</h3>
          <button type="button" onClick={onClose} title="Cerrar"
            className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-3">
          <div>
            <label htmlFor="an-guia" className="block text-xs font-medium text-gray-500 mb-1">Guía</label>
            <select id="an-guia" value={guiaId} onChange={e => elegirGuia(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Seleccione…</option>
              {guias.map(g => <option key={g._id} value={g._id}>{g.nombreCompleto}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="an-curso" className="block text-xs font-medium text-gray-500 mb-1">Curso</label>
            <select id="an-curso" value={curso} onChange={e => elegirCurso(e.target.value)} disabled={!guiaId}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100">
              <option value="">Seleccione…</option>
              {cursos.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="an-salon" className="block text-xs font-medium text-gray-500 mb-1">Salón</label>
            <select id="an-salon" value={salonKey} onChange={e => elegirSalon(e.target.value)} disabled={!curso}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100">
              <option value="">Seleccione…</option>
              {salones.map((s, i) => (
                <option key={`${s.campaign}-${s.salon}-${s.horarioCurso}`} value={String(i)}>
                  {s.salon} · {s.campaign} · {s.horarioCurso}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="an-alumno" className="block text-xs font-medium text-gray-500 mb-1">Usuario</label>
            <select id="an-alumno" value={academicaId} onChange={e => setAcademicaId(e.target.value)} disabled={!salonKey}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100">
              <option value="">Seleccione…</option>
              {alumnos.map(a => <option key={a.academicaId} value={a.academicaId}>{a.nombre} · {a.numeroId}</option>)}
            </select>
            {salonKey && !cargando && alumnos.length === 0 && (
              <p className="text-xs text-amber-700 mt-1">Ese salón no tiene usuarios activos.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="an-modulo" className="block text-xs font-medium text-gray-500 mb-1">Módulo</label>
              <select id="an-modulo" value={modulo}
                onChange={e => { setModulo(e.target.value); setLeccion('') }}
                disabled={!curso}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100">
                <option value="">Todos</option>
                {modulos.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="an-leccion" className="block text-xs font-medium text-gray-500 mb-1">Lección</label>
              <select id="an-leccion" value={leccion} onChange={e => setLeccion(e.target.value)} disabled={!curso}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100">
                <option value="">Seleccione…</option>
                {leccionesModulo.map(l => <option key={`${l.modulo}-${l.value}`} value={l.value}>{l.value}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="an-hora" className="block text-xs font-medium text-gray-500 mb-1">Hora</label>
              <select id="an-hora" value={hora} onChange={e => setHora(e.target.value)} disabled={!curso}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100">
                <option value="">Seleccione…</option>
                {HORAS_NIVELACION.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="an-motivo" className="block text-xs font-medium text-gray-500 mb-1">Motivo</label>
              <input id="an-motivo" type="text" value={motivo} onChange={e => setMotivo(e.target.value)}
                disabled={!curso} maxLength={300} placeholder="Por qué se pide"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100" />
            </div>
          </div>

          {alumno && leccion && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-900">
              Se adicionará una nivelación para <strong>{alumno.nombre}</strong> en{' '}
              <strong>{modulo ? `${modulo} · ` : ''}{leccion}</strong>{hora ? ` a las ${hora}` : ''}, a nombre del guía seleccionado.
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Cancelar</button>
          <button type="button" onClick={crear} disabled={!listo || guardando || cargando}
            className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 font-medium">
            {guardando ? 'Adicionando…' : 'Adicionar Nivelación'}
          </button>
        </div>
      </div>
    </div>
  )
}
