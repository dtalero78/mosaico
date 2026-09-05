'use client'

import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import toast from 'react-hot-toast'
import { CheckCircleIcon, ChatBubbleLeftRightIcon, PlusCircleIcon } from '@heroicons/react/24/outline'
import DashboardLayout from '@/components/layout/DashboardLayout'
import ReportarCasoModal from '@/components/session/ReportarCasoModal'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { ServicioPermission } from '@/types/permissions'
import { exportToExcel } from '@/lib/export-excel'
import { usePermissions } from '@/hooks/usePermissions'
import { estadoLabel, estadoColor, ESTADO_ABIERTO } from '@/lib/casos-atencion-estados'

/**
 * Las seis vistas de la pantalla. Los filtros son los mismos para todas.
 *
 * Las tres primeras salen de la marca del agendamiento o del calendario; las tres
 * últimas salen del ESTADO del caso (endpoint `gestiones`), y por eso llevan
 * `area`. Se agrupan así porque responden a preguntas distintas: qué hay abierto,
 * quién faltó, qué clase quedó vacía, y qué quedó pendiente para cada área.
 */
type Tab = 'casos' | 'asistencia' | 'vacias' | 'academicos' | 'nivelaciones' | 'coordinador' | 'financieros' | 'historico'

interface TabCfg {
  id: Tab; label: string; endpoint: string; vacio: string; descripcion: string
  /** Sólo en las pestañas que leen el estado del caso. */
  area?: string
}

const TABS: TabCfg[] = [
  {
    id: 'casos', label: 'Casos de Atención',
    endpoint: '/api/postgres/reports/servicio/casos-atencion',
    vacio: 'Sin casos de atención abiertos',
    descripcion: 'Estudiantes con un caso de atención abierto (registrado por el guía en la sesión).',
  },
  {
    id: 'asistencia', label: 'Asistencia',
    endpoint: '/api/postgres/reports/servicio/casos-atencion/asistencia',
    vacio: 'No hubo inasistentes',
    descripcion: 'Estudiantes que no asistieron a las sesiones de la semana.',
  },
  {
    id: 'vacias', label: 'Sesiones vacías',
    endpoint: '/api/postgres/reports/servicio/casos-atencion/sesiones-vacias',
    vacio: 'No hubo clases vacías',
    descripcion: 'Sesiones de la semana a las que no asistió ningún estudiante, agrupadas por curso y salón.',
  },
  {
    id: 'academicos', label: 'Académicos',
    endpoint: '/api/postgres/reports/servicio/casos-atencion/gestiones', area: 'academicos',
    vacio: 'Sin gestiones académicas pendientes',
    descripcion: 'Casos que quedaron en Cambio Curso, Cambio de Nivel o Solicitud Congelamiento.',
  },
  {
    id: 'nivelaciones', label: 'Nivelaciones',
    endpoint: '/api/postgres/reports/servicio/casos-atencion/gestiones', area: 'nivelaciones',
    vacio: 'Sin casos derivados a Nivelaciones',
    descripcion: 'Casos que derivaron en reforzarle al alumno un punto del curso.',
  },
  {
    id: 'coordinador', label: 'Coordinador',
    endpoint: '/api/postgres/reports/servicio/casos-atencion/gestiones', area: 'coordinacion',
    vacio: 'Sin casos remitidos a Coordinación',
    descripcion: 'Casos que Servicio remitió al Coordinador Académico para que decida.',
  },
  {
    id: 'financieros', label: 'Financieros',
    endpoint: '/api/postgres/reports/servicio/casos-atencion/gestiones', area: 'financieros',
    vacio: 'Sin gestiones financieras pendientes',
    descripcion: 'Casos que quedaron en Cierre financiero o Envío Pre-jurídico.',
  },
  {
    id: 'historico', label: 'Histórico',
    endpoint: '/api/postgres/reports/servicio/casos-atencion/gestiones', area: 'historico',
    vacio: 'Sin casos cerrados en el período',
    descripcion: 'Casos cerrados del último mes. Usa las fechas para consultar otro período.',
  },
]

/** Las tres que leen el estado del caso comparten columnas y comportamiento. */
/**
 * A dónde puede asignarse un caso desde la bandeja. Cada destino guarda un
 * estado y con eso el caso aparece en su pestaña — el mapeo estado→pestaña vive
 * en lib/casos-atencion-estados, así que aquí sólo se nombra el estado.
 *
 * "Cerrar" no manda a ninguna bandeja: el caso no deja nada pendiente y sólo va
 * al Histórico. Por eso es el único que exige comentario.
 */
const DESTINOS: { estado: string; label: string; detalle: string; clase: string }[] = [
  { estado: 'REMITIDO_A_SERVICIO_ACADEMICO', label: 'Servicio Académico',
    detalle: 'Cambio de nivel, congelamiento y demás trámites del área.',
    clase: 'border-indigo-300 text-indigo-800 hover:bg-indigo-50' },
  { estado: 'REMITIDO_A_NIVELACION', label: 'Nivelación',
    detalle: 'Al alumno hay que reforzarle un punto del curso.',
    clase: 'border-orange-300 text-orange-800 hover:bg-orange-50' },
  { estado: 'REMITIDO_A_COORDINACION', label: 'Coordinador Académico',
    detalle: 'La decisión la toma el Coordinador (incluye cambio de curso).',
    clase: 'border-teal-300 text-teal-800 hover:bg-teal-50' },
  { estado: 'REMITIDO_A_FINANZAS', label: 'Área Financiera',
    detalle: 'Cierre financiero o cobranza pre-jurídica.',
    clase: 'border-rose-300 text-rose-800 hover:bg-rose-50' },
  { estado: 'RESUELTO', label: 'Cerrar',
    detalle: 'Se resolvió y no requiere nada más. Pide comentario.',
    clase: 'border-gray-300 text-gray-700 hover:bg-gray-50' },
]

/**
 * En Nivelaciones la columna Estado no distingue nada — todas las filas tienen
 * el mismo — así que su lugar lo ocupa el DETALLE: el comentario con el que se
 * asignó el caso, que es el encargo concreto para el área.
 */
const MUESTRA_DETALLE = (t: Tab) => t === 'nivelaciones'

/**
 * Destinos que exigen texto: CERRAR (hay que justificar por qué el caso no
 * requiere nada más) y NIVELACIÓN (el texto ES el encargo — qué hay que
 * reforzarle al alumno — y es lo que se muestra en la columna Detalle).
 */
const EXIGE_TEXTO = (d: string | null) => d === 'RESUELTO' || d === 'REMITIDO_A_NIVELACION'

const ES_GESTION = (t: Tab) =>
  t === 'historico' || t === 'academicos' || t === 'financieros' ||
  t === 'coordinador' || t === 'nivelaciones'

interface Row {
  bookingId: string
  academicaId: string
  curso: string | null
  nombre: string
  numeroId: string | null
  contrato: string | null
  /** PEOPLE._id del titular: el nº de contrato enlaza a SU pestaña Financiera. */
  titularId: string | null
  salon: string | null
  leccion: string | null
  tema: string | null
  guia: string | null
  caso: string | null
  conteo: number
  fecha: string | null
  // Estado REAL del caso (viene de CASOS_ATENCION, no de la marca del booking)
  estado?: string | null
  codigoCaso?: string | null
  // Sólo en las pestañas de gestión
  casoId?: string
  acuerdo?: string | null
  cerradoPor?: string | null
  detalle?: string | null
  fechaEstado?: string | null
  // Sólo en la pestaña Asistencia
  contactadoApoderado?: boolean
  recordatorioEnviado?: boolean
  apoderado?: string | null
  apoderadoTelefono?: string | null
}
interface SesionVacia {
  eventoId: string
  curso: string | null
  salon: string | null
  leccion: string | null
  tema: string | null
  guia: string | null
  fecha: string | null
  inscritos: number
}
interface Grupo { curso: string; salon: string; sesiones: SesionVacia[] }
interface Guia { id: string; nombre: string }

const fmtFecha = (f: string | null) => (f ? new Date(f).toLocaleDateString('es-CL') : '—')

// Las 2 últimas columnas de Asistencia van fijas a la derecha para que el botón de
// enviar no quede fuera de pantalla. El ancho de la última se fija para que el
// desplazamiento de la penúltima calce exacto y no queden solapadas.
const ACCION_W = 'w-[112px] min-w-[112px]'
const ACCION_RIGHT = 'right-[112px]'

function CasosAtencionContent() {
  const { hasPermission } = usePermissions()
  const canGestion = hasPermission(ServicioPermission.CASOS_ATENCION_GESTION as any)

  const [tab, setTab] = useState<Tab>('casos')
  const cfg = TABS.find(t => t.id === tab)!

  // "Adicionar caso": el mismo modal del panel del guía. Aquí no hay sesión de la
  // que sacar el guía ni el alumno, así que el modal los pide en cascada.
  const [adicionar, setAdicionar] = useState(false)

  const [campaign, setCampaign] = useState('')
  const [curso, setCurso] = useState('')
  const [salon, setSalon] = useState('')
  const [leccion, setLeccion] = useState('')
  const [guia, setGuia] = useState('')
  const [usuario, setUsuario] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const [rows, setRows] = useState<Row[]>([])
  const [grupos, setGrupos] = useState<Grupo[]>([])
  const [total, setTotal] = useState(0)
  const [campanias, setCampanias] = useState<string[]>([])
  const [cursos, setCursos] = useState<string[]>([])
  const [salones, setSalones] = useState<string[]>([])
  const [lecciones, setLecciones] = useState<string[]>([])
  const [guias, setGuias] = useState<Guia[]>([])
  const [loading, setLoading] = useState(true)

  // Modal de "Resuelto" (pestaña Casos)
  const [resolver, setResolver] = useState<Row | null>(null)
  const [comentario, setComentario] = useState('')
  const [destino, setDestino] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Confirmación del WhatsApp (pestaña Asistencia)
  const [recordar, setRecordar] = useState<Row | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [marcando, setMarcando] = useState<string | null>(null)

  // Desglose por estado de la pestaña activa: en una lista que junta varias
  // gestiones, el total solo no dice cuánto hay de cada una.
  const [porEstado, setPorEstado] = useState<Array<{ estado: string; n: number }>>([])

  // Cada carga lleva número. Al cambiar de pestaña deprisa las respuestas vuelven
  // desordenadas y la de la pestaña anterior pisaba los datos de la nueva: se veía
  // "Asistencia" con el total de "Sesiones vacías". Sólo pinta la última pedida.
  const reqRef = useRef(0)

  const fetchData = useCallback(async (t: Tab, f?: Record<string, string>) => {
    const req = ++reqRef.current
    setLoading(true)
    try {
      const conf = TABS.find(x => x.id === t)!
      const qs = new URLSearchParams()
      if (conf.area) qs.set('area', conf.area)
      Object.entries(f || {}).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const r = await fetch(`${conf.endpoint}?${qs}`, { cache: 'no-store' }).then(x => x.json())
      if (req !== reqRef.current) return   // llegó tarde: ya hay otra pestaña
      if (r.error) throw new Error(r.error)
      setRows(r.rows || [])
      setGrupos(r.grupos || [])
      setTotal(r.total ?? (r.rows?.length || 0))
      setCampanias(r.campanias || [])
      setCursos(r.cursos || []); setSalones(r.salones || []); setLecciones(r.lecciones || []); setGuias(r.guias || [])
      setPorEstado(r.porEstado || [])
    } catch (e: any) {
      if (req !== reqRef.current) return
      toast.error(e?.message || 'Error al cargar')
      setRows([]); setGrupos([]); setTotal(0); setPorEstado([])
    } finally {
      if (req === reqRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData(tab) }, [tab, fetchData])

  const filtros = { campaign, curso, salon, leccion, guia, usuario, startDate, endDate }
  const aplicar = () => fetchData(tab, filtros)

  const borrar = () => {
    setCampaign(''); setCurso(''); setSalon(''); setLeccion(''); setGuia(''); setUsuario('')
    setStartDate(''); setEndDate('')
    fetchData(tab)
  }
  const cambiarTab = (t: Tab) => {
    setCampaign(''); setCurso(''); setSalon(''); setLeccion(''); setGuia(''); setUsuario('')
    setStartDate(''); setEndDate('')
    setTab(t)
  }

  const exportar = () => {
    if (tab === 'vacias') {
      const planas = grupos.flatMap(g => g.sesiones.map(s => ({ ...s, curso: g.curso, salon: g.salon })))
      exportToExcel(planas, [
        { header: 'Curso', accessor: r => r.curso || '' },
        { header: 'Salón', accessor: r => r.salon || '' },
        { header: 'Inscritos que faltaron', accessor: r => (r.inscritos ?? '') },
        { header: 'Lección', accessor: r => r.leccion || '' },
        { header: 'Tema', accessor: r => r.tema || '' },
        { header: 'Guía', accessor: r => r.guia || '' },
        { header: 'Fecha', accessor: r => fmtFecha(r.fecha) },
      ], 'sesiones-vacias')
      return
    }
    // El CSV sigue a la tabla: en Casos van las mismas columnas que se ven.
    if (ES_GESTION(tab)) {
      exportToExcel(rows, [
        { header: 'Curso', accessor: (r: Row) => r.curso || '' },
        { header: 'Nombre', accessor: (r: Row) => r.nombre || '' },
        { header: 'Contrato', accessor: (r: Row) => r.contrato || '' },
        { header: 'ID', accessor: (r: Row) => r.numeroId || '' },
        { header: 'Salón', accessor: (r: Row) => r.salon || '' },
        { header: 'Guía', accessor: (r: Row) => r.guia || '' },
        { header: 'Fecha', accessor: (r: Row) => fmtFecha(r.fechaEstado || null) },
        MUESTRA_DETALLE(tab)
          ? { header: 'Detalle', accessor: (r: Row) => r.detalle || '' }
          : { header: 'Estado', accessor: (r: Row) => estadoLabel(r.estado) },
        { header: 'Caso', accessor: (r: Row) => r.codigoCaso || '' },
        { header: 'Acuerdo', accessor: (r: Row) => r.acuerdo || '' },
        { header: 'Cerrado por', accessor: (r: Row) => r.cerradoPor || '' },
      ], `casos-${tab}`)
      return
    }

    const cols: any[] = tab === 'casos' ? [
      { header: 'Curso', accessor: (r: Row) => r.curso || '' },
      { header: 'Nombre', accessor: (r: Row) => r.nombre || '' },
      { header: 'Contrato', accessor: (r: Row) => r.contrato || '' },
      { header: 'ID', accessor: (r: Row) => r.numeroId || '' },
      { header: 'Salón', accessor: (r: Row) => r.salon || '' },
      { header: 'Guía', accessor: (r: Row) => r.guia || '' },
    ] : [
      { header: 'Curso', accessor: (r: Row) => r.curso || '' },
      { header: 'Nombre', accessor: (r: Row) => r.nombre || '' },
      { header: 'ID', accessor: (r: Row) => r.numeroId || '' },
      { header: 'Salón', accessor: (r: Row) => r.salon || '' },
      { header: 'Lección', accessor: (r: Row) => r.leccion || '' },
      { header: 'Tema', accessor: (r: Row) => r.tema || '' },
      { header: 'Guía', accessor: (r: Row) => r.guia || '' },
    ]
    // Fecha va antes que la última columna para que el CSV siga el orden de la
    // tabla (…Guía · Fecha · Estado).
    cols.push({ header: 'Fecha', accessor: (r: Row) => fmtFecha(r.fecha) })
    if (tab === 'casos') {
      cols.push({ header: 'Estado', accessor: (r: Row) => (r.estado && r.estado !== ESTADO_ABIERTO ? estadoLabel(r.estado) : 'Pendiente') })
    } else {
      cols.push(
        { header: 'Contactado apoderado', accessor: (r: Row) => (r.contactadoApoderado ? 'Sí' : 'No') },
        { header: 'Recordatorio enviado', accessor: (r: Row) => (r.recordatorioEnviado ? 'Sí' : 'No') },
      )
    }
    exportToExcel(rows, cols, tab === 'casos' ? 'casos-atencion' : 'inasistencias-semana')
  }

  const confirmarResuelto = async () => {
    if (!resolver || !destino) return
    const cierra = destino === 'RESUELTO'
    if (EXIGE_TEXTO(destino) && !comentario.trim()) {
      toast.error(cierra ? 'El comentario es obligatorio al cerrar'
        : 'El detalle de la nivelación es obligatorio'); return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/postgres/students/${resolver.academicaId}/caso-atencion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: resolver.bookingId, comentario: comentario.trim(), estado: destino }),
      }).then(x => x.json())
      if (res.error) throw new Error(res.error)
      toast.success(cierra ? 'Caso cerrado'
        : `Caso asignado a ${DESTINOS.find(d => d.estado === destino)?.label || destino}`)
      setRows(prev => prev.filter(x => x.bookingId !== resolver.bookingId))
      setResolver(null); setComentario(''); setDestino(null)
    } catch (e: any) {
      toast.error(e?.message || 'Error')
    } finally {
      setSaving(false)
    }
  }

  const marcarContactado = async (r: Row, valor: boolean) => {
    setMarcando(r.bookingId)
    // Optimista: la casilla responde al instante y se revierte si falla.
    setRows(prev => prev.map(x => x.bookingId === r.bookingId ? { ...x, contactadoApoderado: valor } : x))
    try {
      const res = await fetch('/api/postgres/reports/servicio/casos-atencion/asistencia/contactado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: r.bookingId, academicaId: r.academicaId, numeroId: r.numeroId, contactado: valor }),
      }).then(x => x.json())
      if (res.error) throw new Error(res.error)
    } catch (e: any) {
      setRows(prev => prev.map(x => x.bookingId === r.bookingId ? { ...x, contactadoApoderado: !valor } : x))
      toast.error(e?.message || 'No se pudo guardar')
    } finally {
      setMarcando(null)
    }
  }

  const confirmarRecordatorio = async () => {
    if (!recordar) return
    setEnviando(true)
    try {
      const res = await fetch('/api/postgres/reports/servicio/casos-atencion/asistencia/recordatorio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: recordar.bookingId }),
      }).then(x => x.json())
      if (res.error) throw new Error(res.error)
      toast.success(`Recordatorio enviado al ${res.destinatario} (${res.to})`)
      setRows(prev => prev.map(x => x.bookingId === recordar.bookingId ? { ...x, recordatorioEnviado: true } : x))
      setRecordar(null)
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo enviar')
    } finally {
      setEnviando(false)
    }
  }

  const hayDatos = tab === 'vacias' ? grupos.length > 0 : rows.length > 0
  const columnas = ES_GESTION(tab)
    ? ['Curso', 'Nombre', 'Contrato', 'ID', 'Salón', 'Guía', 'Fecha',
       MUESTRA_DETALLE(tab) ? 'Detalle' : 'Estado']
    : tab === 'casos'
    ? ['Curso', 'Nombre', 'Contrato', 'ID', 'Salón', 'Guía', 'Fecha', 'Estado']
    : tab === 'asistencia'
      ? ['Curso', 'Nombre', 'Salón', 'Lección (tema)', 'Guía', 'Fecha', 'Contactado apoderado', 'Envío recordatorio']
      : ['Curso', 'Faltaron', 'Salón', 'Lección (tema)', 'Guía', 'Fecha']

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Casos de Atención</h1>
          <p className="text-gray-500">
            {cfg.descripcion} Total: <span className="font-semibold text-gray-700">{total}</span>
          </p>
          {/* Desglose por estado: en una pestaña que junta varias gestiones, el
              total solo no dice cuánto hay de cada una. */}
          {ES_GESTION(tab) && porEstado.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {porEstado.map(e => (
                <span key={e.estado}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${estadoColor(e.estado)}`}>
                  {estadoLabel(e.estado)}
                  <span className="font-bold">{e.n}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        {/* Sólo en la pestaña de casos: en Asistencia y Sesiones vacías no hay
            un caso que adicionar, son otra cosa. */}
        {tab === 'casos' && canGestion && (
          <button type="button" onClick={() => setAdicionar(true)}
            className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700">
            <PlusCircleIcon className="h-5 w-5" />
            Adicionar caso
          </button>
        )}
      </div>

      {/* Pestañas */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200 mb-5">
        {TABS.map(t => (
          <button
            key={t.id} type="button" onClick={() => cambiarTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 ${
          tab === 'vacias' ? 'xl:grid-cols-7' : 'xl:grid-cols-8'} gap-3`}>
          {tab !== 'vacias' && (
          <div>
            <label htmlFor="ca-usuario" className="block text-xs font-medium text-gray-500 mb-1">Nombre o ID</label>
            <input id="ca-usuario" type="text" value={usuario} onChange={e => setUsuario(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') aplicar() }}
              placeholder="Nombre o documento"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Campaña</label>
            <select value={campaign} onChange={e => setCampaign(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todas</option>{campanias.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Curso</label>
            <select value={curso} onChange={e => setCurso(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>{cursos.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Salón</label>
            <select value={salon} onChange={e => setSalon(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>{salones.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Lección</label>
            <select value={leccion} onChange={e => setLeccion(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todas</option>{lecciones.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Guía</label>
            <select value={guia} onChange={e => setGuia(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>{guias.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Fecha inicial</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Fecha final</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>
        {(tab === 'asistencia' || tab === 'vacias') && !startDate && !endDate && (
          <p className="text-xs text-gray-400 mt-2">Mostrando la semana en curso (lunes a domingo). Usa las fechas para consultar otro período.</p>
        )}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button type="button" onClick={aplicar} disabled={loading}
            className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium">Aplicar filtros</button>
          <button type="button" onClick={borrar}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Borrar filtros</button>
          <PermissionGuard permission={ServicioPermission.CASOS_ATENCION_EXPORTAR}>
            <button type="button" onClick={exportar} disabled={!hayDatos}
              className="px-3 py-2 text-sm bg-green-100 text-green-700 rounded-lg hover:bg-green-200 disabled:opacity-50 font-medium">Exportar CSV</button>
          </PermissionGuard>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {columnas.map((h, ci) => {
                  // Las 2 columnas de acción de Asistencia se fijan a la derecha
                  // para que el botón de enviar no quede fuera de pantalla.
                  const esAccion = tab === 'asistencia' && ci >= columnas.length - 2
                  const esUltima = ci === columnas.length - 1
                  return (
                    <th key={h}
                      className={`px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide ${
                        esAccion
                          ? `sticky bg-gray-50 z-20 ${esUltima ? `right-0 ${ACCION_W}` : `${ACCION_RIGHT} border-l border-gray-200`}`
                          : 'whitespace-nowrap'
                      }`}
                    >
                      {h}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={columnas.length} className="px-3 py-10 text-center text-gray-400">Cargando…</td></tr>
              ) : !hayDatos ? (
                <tr><td colSpan={columnas.length} className="px-3 py-10 text-center text-gray-400">{cfg.vacio}</td></tr>
              ) : tab === 'vacias' ? (
                grupos.map(g => (
                  <Fragment key={`${g.curso}-${g.salon}`}>
                    <tr className="bg-primary-50/60 border-y border-primary-100">
                      <td colSpan={columnas.length} className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-primary-700">
                        {g.curso} · Salón {g.salon}
                        <span className="ml-2 font-medium text-primary-600/70 normal-case">
                          {g.sesiones.length} sesión(es) sin asistentes
                        </span>
                      </td>
                    </tr>
                    {g.sesiones.map(s => (
                      <tr key={s.eventoId} className="border-b border-gray-100 hover:bg-gray-50 align-top">
                        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{s.curso || '—'}</td>
                        <td className="px-3 py-2">
                          {/* Sin inscritos ≠ nadie asistió: lo primero suele ser
                              que al curso no se le generaron los agendamientos. */}
                          {s.inscritos > 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                              {s.inscritos} inscrito(s), 0 asistieron
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-200 text-gray-600"
                              title="La sesión no tiene ningún estudiante agendado">
                              Sin inscritos
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{s.salon || '—'}</td>
                        <td className="px-3 py-2 text-gray-600">
                          <span className="font-medium text-gray-800">{s.leccion || '—'}</span>
                          {s.tema && <span className="block text-xs text-gray-400">{s.tema}</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{s.guia || '—'}</td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtFecha(s.fecha)}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))
              ) : ES_GESTION(tab) ? rows.map((r) => (
                /* Histórico · Académicos · Financieros: mismas columnas que Casos,
                   sin botón de cerrar — estos ya están cerrados. */
                <tr key={r.casoId} className="group border-b border-gray-100 hover:bg-gray-50 align-top">
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{r.curso || '—'}</td>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    {r.nombre ? (
                      <button
                        type="button"
                        onClick={() => window.open(`/student/${r.academicaId}?tab=casos-atencion`, '_blank', 'noopener,noreferrer')}
                        className="text-primary-600 hover:text-primary-800 hover:underline"
                        title="Ver los casos de atención del beneficiario"
                      >
                        {r.nombre}
                      </button>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.contrato ? (
                      r.titularId ? (
                        <button type="button"
                          onClick={() => window.open(`/person/${r.titularId}?tab=financiera`, '_blank', 'noopener,noreferrer')}
                          className="text-primary-600 hover:text-primary-800 hover:underline"
                          title="Ver la información financiera del titular">
                          {r.contrato}
                        </button>
                      ) : <span className="text-gray-700" title="El contrato no tiene titular registrado">{r.contrato}</span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.numeroId || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{r.salon || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">
                    <span className="block max-w-[150px] truncate" title={r.guia || ''}>{r.guia || '—'}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtFecha(r.fechaEstado || null)}</td>
                  {MUESTRA_DETALLE(tab) ? (
                  <td className="px-3 py-2 text-gray-700">
                    <span className="block max-w-[280px] whitespace-pre-wrap break-words"
                      title={r.detalle || ''}>{r.detalle || '—'}</span>
                  </td>
                  ) : (
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${estadoColor(r.estado)}`}
                      title={[r.codigoCaso ? `Caso ${r.codigoCaso}` : '', r.cerradoPor ? `Cerrado por ${r.cerradoPor}` : '']
                        .filter(Boolean).join(' · ') || undefined}>
                      {estadoLabel(r.estado)}
                    </span>
                    {r.acuerdo && (
                      <span className="block max-w-[220px] truncate text-xs text-gray-500 mt-1" title={r.acuerdo}>
                        {r.acuerdo}
                      </span>
                    )}
                  </td>
                  )}
                </tr>
              )) : tab === 'casos' ? rows.map((r) => (
                /* Curso · Nombre · Contrato · ID · Salón · Guía · Fecha · Estado */
                <tr key={r.bookingId} className="group border-b border-gray-100 hover:bg-gray-50 align-top">
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{r.curso || '—'}</td>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    {r.nombre ? (
                      <button
                        type="button"
                        /* Abre la ficha del alumno directamente en Casos Atención. */
                        onClick={() => window.open(`/student/${r.academicaId}?tab=casos-atencion`, '_blank', 'noopener,noreferrer')}
                        className="text-primary-600 hover:text-primary-800 hover:underline"
                        title="Ver los casos de atención del beneficiario"
                      >
                        {r.nombre}
                      </button>
                    ) : <span className="text-gray-900">—</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.contrato ? (
                      r.titularId ? (
                        <button
                          type="button"
                          /* El resumen financiero es del TITULAR, por eso el enlace
                             va a su ficha y no a la del beneficiario. */
                          onClick={() => window.open(`/person/${r.titularId}?tab=financiera`, '_blank', 'noopener,noreferrer')}
                          className="text-primary-600 hover:text-primary-800 hover:underline"
                          title="Ver la información financiera del titular"
                        >
                          {r.contrato}
                        </button>
                      ) : <span className="text-gray-700" title="El contrato no tiene titular registrado">{r.contrato}</span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.numeroId || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{r.salon || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">
                    <span className="block max-w-[150px] truncate" title={r.guia || ''}>{r.guia || '—'}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtFecha(r.fecha)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {/* Estado REAL del caso. Esta pestaña sólo lista los abiertos
                        (los cerrados pasan al Histórico), así que en la práctica
                        dice "Pendiente"; se lee del caso y no se escribe en duro
                        para que un cambio hecho en la ficha del alumno se vea. */}
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold mr-2 ${estadoColor(r.estado || ESTADO_ABIERTO)}`}
                      title={r.codigoCaso ? `Caso ${r.codigoCaso}` : undefined}>
                      {r.estado && r.estado !== ESTADO_ABIERTO ? estadoLabel(r.estado) : 'Pendiente'}
                    </span>
                    <button type="button" title="Asignar el caso a un área o cerrarlo"
                      onClick={() => { setResolver(r); setComentario(''); setDestino(null) }}
                      disabled={!canGestion}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed">
                      <CheckCircleIcon className="h-4 w-4" /> Asignar
                    </button>
                  </td>
                </tr>
              )) : rows.map((r) => (
                <tr key={r.bookingId} className="group border-b border-gray-100 hover:bg-gray-50 align-top">
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{r.curso || '—'}</td>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    {r.nombre ? (
                      <button
                        type="button"
                        onClick={() => window.open(`/student/${r.academicaId}`, '_blank', 'noopener,noreferrer')}
                        className="text-primary-600 hover:text-primary-800 hover:underline"
                        title="Ver perfil del beneficiario"
                      >
                        {r.nombre}
                      </button>
                    ) : <span className="text-gray-900">—</span>}
                    {r.numeroId && <span className="block text-xs text-gray-400">{r.numeroId}</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{r.salon || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">
                    <span className="font-medium text-gray-800">{r.leccion || '—'}</span>
                    {r.tema && <span className="block text-xs text-gray-400">{r.tema}</span>}
                  </td>
                  {/* El nombre del guía es largo y empujaba las acciones fuera de
                      pantalla: se acota y el completo queda en el tooltip. */}
                  <td className="px-3 py-2 text-gray-600">
                    <span className="block max-w-[150px] truncate" title={r.guia || ''}>{r.guia || '—'}</span>
                  </td>

                  {/* Sólo la pestaña Asistencia llega aquí: la de Casos tiene su
                      propio bloque de filas arriba, con columnas distintas. */}
                  {(
                    <>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtFecha(r.fecha)}</td>
                      {/* Fijas a la derecha: el botón de enviar debe verse siempre,
                          sin depender del scroll horizontal de la tabla. */}
                      <td className={`px-3 py-2 sticky ${ACCION_RIGHT} bg-white group-hover:bg-gray-50 z-10 border-l border-gray-200`}>
                        <label className={`inline-flex items-center gap-2 ${canGestion ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                          <input
                            type="checkbox"
                            checked={!!r.contactadoApoderado}
                            disabled={!canGestion || marcando === r.bookingId}
                            onChange={e => marcarContactado(r, e.target.checked)}
                            className="h-4 w-4 accent-emerald-600"
                          />
                          <span className="text-xs text-gray-600 whitespace-nowrap">
                            {r.contactadoApoderado ? 'Contactado' : 'Pendiente'}
                          </span>
                        </label>
                        {r.apoderado && (
                          <span className="block max-w-[130px] truncate text-xs text-gray-400 mt-0.5" title={r.apoderado}>{r.apoderado}</span>
                        )}
                      </td>
                      <td className={`px-3 py-2 sticky right-0 bg-white group-hover:bg-gray-50 z-10 ${ACCION_W}`}>
                        <button type="button"
                          title={r.recordatorioEnviado ? 'Ya se envió — puedes volver a enviarlo' : 'Enviar recordatorio por WhatsApp'}
                          onClick={() => setRecordar(r)}
                          disabled={!canGestion}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
                            r.recordatorioEnviado
                              ? 'text-gray-600 bg-gray-100 hover:bg-gray-200'
                              : 'text-green-700 bg-green-50 hover:bg-green-100'
                          }`}>
                          <ChatBubbleLeftRightIcon className="h-4 w-4" />
                          {r.recordatorioEnviado ? 'Reenviar' : 'Enviar'}
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Resuelto */}
      {resolver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setResolver(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Asignar caso</h3>
            <p className="text-sm text-gray-500 mb-4">
              {resolver.nombre} — {resolver.curso || '—'} · Lección {resolver.leccion || '—'}
            </p>
            {resolver.caso && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4 text-sm text-gray-700">
                <p className="text-xs font-semibold text-gray-500 mb-1">Caso registrado por el guía:</p>
                <p className="whitespace-pre-wrap break-words">{resolver.caso}</p>
              </div>
            )}
            <p className="block text-sm font-medium text-gray-700 mb-2">¿A dónde va el caso?</p>
            <div className="space-y-2 mb-4">
              {DESTINOS.map(d => (
                <button key={d.estado} type="button" onClick={() => setDestino(d.estado)} disabled={saving}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border-2 transition-colors disabled:opacity-50 ${
                    destino === d.estado ? d.clase + ' ring-2 ring-offset-1 ring-primary-400' : d.clase
                  }`}>
                  <span className="block text-sm font-semibold">{d.label}</span>
                  <span className="block text-xs opacity-80">{d.detalle}</span>
                </button>
              ))}
            </div>

            <label className="block text-sm font-medium text-gray-700 mb-1">
              {destino === 'REMITIDO_A_NIVELACION' ? 'Detalle de la nivelación' : 'Comentario'}
              {EXIGE_TEXTO(destino) && <span className="text-red-500"> *</span>}
            </label>
            <textarea
              value={comentario}
              onChange={e => setComentario(e.target.value)}
              rows={3}
              placeholder={destino === 'RESUELTO'
                ? 'Describe cómo se resolvió el caso…'
                : destino === 'REMITIDO_A_NIVELACION'
                ? 'Qué hay que reforzarle al alumno. Se verá en la columna Detalle.'
                : 'Opcional: qué debe atender el área que lo reciba.'}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
            <p className="text-xs text-gray-400 mt-1">Se agrega al historial del estudiante y el caso sale de esta bandeja.</p>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => { setResolver(null); setDestino(null) }} disabled={saving}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={confirmarResuelto}
                disabled={saving || !destino || (EXIGE_TEXTO(destino) && !comentario.trim())}
                className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium">
                {saving ? 'Guardando…' : destino === 'RESUELTO' ? 'Cerrar caso' : 'Asignar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmación del recordatorio por WhatsApp */}
      {recordar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !enviando && setRecordar(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Enviar recordatorio por WhatsApp</h3>
            <p className="text-sm text-gray-500 mb-4">
              {recordar.nombre} — {recordar.curso || '—'} · Lección {recordar.leccion || '—'} · {fmtFecha(recordar.fecha)}
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-800">
              Se enviará un aviso de inasistencia. En YOJI, OKINA, KODOMO y DANSHI va al <b>apoderado</b>;
              en SENPAI e IMPULSA, al <b>estudiante</b>.
              {recordar.recordatorioEnviado && <span className="block mt-1 font-semibold">Ya se envió antes: este sería un reenvío.</span>}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRecordar(null)} disabled={enviando}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={confirmarRecordatorio} disabled={enviando}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium">
                {enviando ? 'Enviando…' : 'Enviar recordatorio'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mismo modal que usa el guía en su sesión, con la cascada Guía → Curso →
          Salón → Usuario: aquí no hay sesión de la que tomarlos. */}
      {adicionar && (
        <ReportarCasoModal
          conCascada
          onClose={() => setAdicionar(false)}
          onEnviado={(r) => {
            toast.success(r.abrioCaso ? `Se abrió el caso ${r.codigo}` : `Reporte agregado al caso ${r.codigo}`)
            fetchData(tab, filtros)   // el caso nuevo debe aparecer en la lista
          }}
        />
      )}
    </div>
  )
}

export default function CasosAtencionPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={ServicioPermission.CASOS_ATENCION_VER} showDefaultMessage>
        <CasosAtencionContent />
      </PermissionGuard>
    </DashboardLayout>
  )
}
