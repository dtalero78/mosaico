'use client'

import { useEffect, useState } from 'react'

/**
 * "Reportar a <alumno>" — el punto donde NACE un reporte (R1).
 *
 * Si el alumno ya tiene casos abiertos, el backend rechaza el envío sin destino
 * y devuelve la lista; entonces este modal pregunta si el reporte suma al caso
 * abierto o abre uno nuevo (R2). Sin casos abiertos se envía derecho.
 *
 * Sirve a DOS entradas con el mismo componente, para que no puedan divergir:
 *
 *  - **Panel del guía** (dentro de una sesión): el alumno y el guía vienen dados
 *    — es su clase y él es el autor. Se pasa `academicaId` y ya.
 *  - **Servicio › Casos de Atención** (botón "Adicionar caso"): no hay sesión de
 *    la que colgarse, así que con `conCascada` se piden **Guía → Curso → Salón →
 *    Usuario**. Es el alta de un caso que el guía reportó por teléfono o
 *    WhatsApp, así que hay que decir de quién es la observación.
 *
 * Que el usuario salga del salón DEL GUÍA no es comodidad: es lo que impide
 * firmar un reporte a nombre de alguien que no da esa clase. El servidor vuelve
 * a exigir el permiso y a comprobar el guía — los desplegables no son la barrera.
 */

const TEMAS = [
  { id: 'ASISTENCIA', label: 'Asistencia' },
  { id: 'CONDUCTA', label: 'Conducta' },
  { id: 'DESEMPENO', label: 'Desempeño' },
  { id: 'SALUD', label: 'Salud' },
  { id: 'PAGO', label: 'Pago' },
  { id: 'OTRO', label: 'Otro' },
]

interface CasoAbierto {
  _id: string
  codigo: string
  tema: string
  diasAbierto: number
  reportes: number
  ultimaGestion: string | null
}

interface GuiaOpcion { _id: string; nombreCompleto?: string | null }
/** Un salón se identifica por (campaña, curso, horario), no por su número. */
interface SalonOpcion { salon: string; campaign: string; horarioCurso: string }
interface AlumnoOpcion { academicaId: string; nombre: string; numeroId?: string | null; contrato?: string | null }

const OPCIONES = '/api/postgres/casos-atencion/alta-opciones'

export default function ReportarCasoModal({
  academicaId: academicaIdProp, alumno: alumnoProp, eventoId, bookingId, sesionLabel,
  conCascada = false, onClose, onEnviado,
}: {
  /** ACADEMICA._id. Vacío cuando el alumno se elige dentro del modal. */
  academicaId?: string
  alumno?: string
  eventoId?: string | null
  bookingId?: string | null
  sesionLabel?: string
  /** Alta desde Servicio: pide Guía → Curso → Salón → Usuario. */
  conCascada?: boolean
  onClose: () => void
  onEnviado?: (r: { codigo: string; abrioCaso: boolean }) => void
}) {
  const [texto, setTexto] = useState('')
  const [tema, setTema] = useState('ASISTENCIA')
  const [abiertos, setAbiertos] = useState<CasoAbierto[]>([])
  const [destino, setDestino] = useState<string>('')   // casoId | 'nuevo'
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Cascada Guía → Curso → Salón → Usuario. Cada nivel se pide al servidor
  // cuando el anterior queda elegido, así nunca se ofrece una opción que
  // devolvería una lista vacía.
  const [guiaId, setGuiaId] = useState('')
  const [curso, setCurso] = useState('')
  const [salonIdx, setSalonIdx] = useState('')      // índice dentro de `salones`
  const [alumnoId, setAlumnoId] = useState('')
  const [guias, setGuias] = useState<GuiaOpcion[]>([])
  const [cursos, setCursos] = useState<string[]>([])
  const [salones, setSalones] = useState<SalonOpcion[]>([])
  const [alumnos, setAlumnos] = useState<AlumnoOpcion[]>([])
  const [cargando, setCargando] = useState(false)

  const salonSel = salones[Number(salonIdx)] || null
  const alumnoSel = alumnos.find(a => a.academicaId === alumnoId) || null

  const academicaId = academicaIdProp || alumnoId || ''
  const alumno = alumnoProp || alumnoSel?.nombre || ''

  /** Un paso de la cascada. Cada uno limpia los de abajo: quedarían inválidos. */
  const pedir = (qs: string, aplicar: (j: any) => void) => {
    setCargando(true)
    fetch(`${OPCIONES}${qs}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (j?.success) aplicar(j); else setErr(j?.error || 'No se pudieron cargar las opciones.') })
      .catch(() => setErr('No se pudieron cargar las opciones.'))
      .finally(() => setCargando(false))
  }

  useEffect(() => {
    if (!conCascada) return
    pedir('', (j) => setGuias(j.guias || []))
  }, [conCascada])

  const elegirGuia = (id: string) => {
    setGuiaId(id); setCurso(''); setSalonIdx(''); setAlumnoId('')
    setCursos([]); setSalones([]); setAlumnos([])
    if (id) pedir(`?guiaId=${encodeURIComponent(id)}`, (j) => setCursos(j.cursos || []))
  }
  const elegirCurso = (c: string) => {
    setCurso(c); setSalonIdx(''); setAlumnoId('')
    setSalones([]); setAlumnos([])
    if (c) pedir(`?guiaId=${encodeURIComponent(guiaId)}&curso=${encodeURIComponent(c)}`,
      (j) => setSalones(j.salones || []))
  }
  const elegirSalon = (idx: string) => {
    setSalonIdx(idx); setAlumnoId(''); setAlumnos([])
    const s = salones[Number(idx)]
    if (s) pedir(`?guiaId=${encodeURIComponent(guiaId)}&curso=${encodeURIComponent(curso)}`
      + `&salon=${encodeURIComponent(s.salon)}&campaign=${encodeURIComponent(s.campaign)}`
      + `&horarioCurso=${encodeURIComponent(s.horarioCurso)}`,
      (j) => setAlumnos(j.alumnos || []))
  }

  // Se consultan al abrir para poder mostrar el aviso ANTES de escribir, no
  // sólo al chocar contra el rechazo del backend. Al cambiar de alumno se
  // reinician: los casos abiertos del anterior no son los de éste.
  useEffect(() => {
    setAbiertos([]); setDestino('')
    if (!academicaId) return
    let vivo = true
    fetch(`/api/postgres/casos-atencion/reportes?academicaId=${encodeURIComponent(academicaId)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        if (!vivo || !j?.success) return
        setAbiertos(j.casosAbiertos || [])
        // Sumar al caso abierto es lo habitual: suele ser la misma situación.
        if (j.casosAbiertos?.length) setDestino(j.casosAbiertos[0]._id)
      })
      .catch(() => { /* el backend vuelve a validar al enviar */ })
    return () => { vivo = false }
  }, [academicaId])

  const enviar = async () => {
    if (conCascada && !guiaId) { setErr('Elige el guía.'); return }
    if (!academicaId) { setErr('Elige al usuario.'); return }
    if (!texto.trim()) { setErr('Escribe el comentario.'); return }
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/postgres/casos-atencion/reportes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          academicaId, texto, tema, eventoId: eventoId ?? null, bookingId: bookingId ?? null,
          guiaId: guiaId || undefined,
          destino: abiertos.length ? (destino || 'nuevo') : null,
        }),
      })
      const j = await res.json()
      if (!j?.success) {
        // Si el alumno abrió un caso mientras el modal estaba abierto, el
        // backend lo devuelve y se pregunta en vez de fallar.
        if (j?.detail?.tipo === 'caso_abierto') {
          setAbiertos(j.detail.casosAbiertos || [])
          setDestino(j.detail.casosAbiertos?.[0]?._id || 'nuevo')
          setErr('El alumno tiene un caso abierto: indica dónde va este reporte.')
          return
        }
        setErr(j?.error || 'No se pudo enviar el reporte.')
        return
      }
      onEnviado?.({ codigo: j.codigo, abrioCaso: j.abrioCaso })
      onClose()
    } catch (e: any) {
      setErr(e?.message || 'Error de red.')
    } finally { setBusy(false) }
  }

  const caso = abiertos[0]

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto">
        {sesionLabel && <p className="text-xs text-gray-500">{sesionLabel}</p>}
        <h3 className="text-xl font-semibold text-gray-900">
          {alumno ? `Reportar a ${alumno}` : 'Adicionar caso de atención'}
        </h3>

        {/* Cascada Guía → Curso → Salón → Usuario. Sólo en el alta de Servicio:
            desde la sesión del guía esos cuatro datos ya vienen dados. */}
        {conCascada && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="caso-guia" className="block text-sm font-medium text-gray-700">Guía</label>
              <select id="caso-guia" value={guiaId} onChange={e => elegirGuia(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500">
                <option value="">— Selecciona —</option>
                {guias.map(g => <option key={g._id} value={g._id}>{g.nombreCompleto || g._id}</option>)}
              </select>
            </div>

            <div>
              <label htmlFor="caso-curso" className="block text-sm font-medium text-gray-700">Curso</label>
              <select id="caso-curso" value={curso} onChange={e => elegirCurso(e.target.value)}
                disabled={!guiaId || !cursos.length}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100">
                <option value="">{guiaId ? '— Selecciona —' : '— Elige el guía —'}</option>
                {cursos.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label htmlFor="caso-salon" className="block text-sm font-medium text-gray-700">Salón</label>
              <select id="caso-salon" value={salonIdx} onChange={e => elegirSalon(e.target.value)}
                disabled={!curso || !salones.length}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100">
                <option value="">{curso ? '— Selecciona —' : '— Elige el curso —'}</option>
                {/* La campaña va en la etiqueta: el mismo "02" existe en varias. */}
                {salones.map((s, i) => (
                  <option key={`${s.campaign}-${s.salon}-${s.horarioCurso}`} value={String(i)}>
                    {s.salon} · {s.campaign}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="caso-alumno" className="block text-sm font-medium text-gray-700">Usuario</label>
              <select id="caso-alumno" value={alumnoId} onChange={e => setAlumnoId(e.target.value)}
                disabled={!salonSel || !alumnos.length}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100">
                <option value="">{salonSel ? '— Selecciona —' : '— Elige el salón —'}</option>
                {alumnos.map(a => (
                  <option key={a.academicaId} value={a.academicaId}>
                    {a.nombre}{a.numeroId ? ` · ${a.numeroId}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-span-2 min-h-[1rem]">
              {cargando && <p className="text-xs text-gray-400">Cargando…</p>}
              {!cargando && salonSel && !alumnos.length && (
                <p className="text-xs text-amber-700">Ese salón no tiene usuarios activos.</p>
              )}
              {!cargando && alumnoSel && (
                <p className="text-xs text-gray-500">
                  El reporte queda a nombre del guía; se registra que lo capturaste tú.
                </p>
              )}
            </div>
          </div>
        )}
        {conCascada && (
          <label htmlFor="caso-texto" className="mt-4 block text-sm font-medium text-gray-700">Comentario</label>
        )}
        <textarea
          id="caso-texto"
          value={texto} onChange={e => setTexto(e.target.value)} rows={4}
          autoFocus={!conCascada}
          placeholder="Describe qué pasó en la sesión…"
          className={`${conCascada ? 'mt-1' : 'mt-4'} w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500`}
        />

        {/* Aviso + decisión de destino (R2) */}
        {caso && (
          <>
            <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-4">
              <p className="font-medium text-amber-800">Ya hay un caso abierto</p>
              <p className="text-sm text-amber-700 mt-1">
                {caso.codigo} · {(TEMAS.find(t => t.id === caso.tema)?.label || caso.tema).toLowerCase()} ·
                {' '}abierto hace {caso.diasAbierto} día(s), {caso.reportes} reporte(s).
                {caso.ultimaGestion && <> Última gestión: {caso.ultimaGestion}.</>}
              </p>
            </div>

            <p className="mt-4 text-sm text-gray-600">¿Dónde va este reporte?</p>
            <div className="mt-2 space-y-2">
              {abiertos.map(c => (
                <label key={c._id}
                  className={`flex gap-3 p-3 rounded-lg border cursor-pointer ${destino === c._id
                    ? 'border-primary-500 ring-1 ring-primary-500 bg-primary-50/40'
                    : 'border-gray-200 hover:bg-gray-50'}`}>
                  <input type="radio" name="destino" checked={destino === c._id}
                    onChange={() => setDestino(c._id)} className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium text-gray-900">
                      Sumar al caso abierto{abiertos.length > 1 && ` ${c.codigo}`}
                    </span>
                    <span className="block text-xs text-gray-500">Es la misma situación que ya se está gestionando</span>
                  </span>
                </label>
              ))}
              <label className={`flex gap-3 p-3 rounded-lg border cursor-pointer ${destino === 'nuevo'
                ? 'border-primary-500 ring-1 ring-primary-500 bg-primary-50/40'
                : 'border-gray-200 hover:bg-gray-50'}`}>
                <input type="radio" name="destino" checked={destino === 'nuevo'}
                  onChange={() => setDestino('nuevo')} className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium text-gray-900">Abrir un caso nuevo</span>
                  <span className="block text-xs text-gray-500">Es otro tema, sin relación con el anterior</span>
                </span>
              </label>
            </div>
          </>
        )}

        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

        <div className="mt-5 flex items-center justify-between gap-3">
          <div>
            {conCascada && (
              <label htmlFor="caso-tema" className="block text-sm font-medium text-gray-700 mb-1">
                Tipo de caso
              </label>
            )}
            <select id="caso-tema" value={tema} onChange={e => setTema(e.target.value)}
              title="Tipo de caso" aria-label="Tipo de caso"
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
              {TEMAS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy}
              className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
              Cancelar
            </button>
            <button type="button" onClick={enviar}
              disabled={busy || !texto.trim() || !academicaId || (conCascada && !guiaId)}
              className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm hover:bg-primary-700 disabled:opacity-50">
              {busy ? 'Enviando…' : 'Enviar reporte'}
            </button>
          </div>
        </div>

        <p className="mt-3 text-xs text-gray-400">
          El reporte no se puede editar ni borrar una vez enviado: las correcciones se hacen con otro reporte.
        </p>
      </div>
    </div>
  )
}
