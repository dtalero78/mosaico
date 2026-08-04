'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { AcademicoPermission } from '@/types/permissions'
import { computeImpulsaCalendario, defaultEntrenHora, EVAL_HORA_DEFAULT, type ImpulsaConfig } from '@/lib/impulsa-calendario'

type Fija = { fecha: string; horaInicio: string }

export default function CrearImpulsaPage() {
  const [campaign, setCampaign] = useState('')
  const [salon, setSalon] = useState('01')
  const [cupos, setCupos] = useState(20)
  const [guia, setGuia] = useState('')
  const [guias, setGuias] = useState<{ _id: string; nombreCompleto: string }[]>([])
  const [campaigns, setCampaigns] = useState<string[]>([])
  const [nuevaCampaign, setNuevaCampaign] = useState(false)
  const [inicio, setInicio] = useState('')
  const [fin, setFin] = useState('')
  const [festivos, setFestivos] = useState<string[]>([])
  const [entrenamientos, setEntrenamientos] = useState<Fija[]>([])
  const [evaluaciones, setEvaluaciones] = useState<Fija[]>([])
  const [confirmar, setConfirmar] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/postgres/guias', { cache: 'no-store' }).then(r => r.json())
      .then(d => setGuias(d.guias || d.data || [])).catch(() => setGuias([]))
    fetch('/api/postgres/cursos-campaign', { cache: 'no-store' }).then(r => r.json())
      .then(d => setCampaigns([...new Set(((d.rows || []) as any[]).map(x => x.campaign).filter(Boolean))].sort().reverse() as string[]))
      .catch(() => setCampaigns([]))
  }, [])

  const config: ImpulsaConfig = {
    inicioSesiones: inicio, finSesiones: fin,
    festivos: festivos.filter(Boolean),
    entrenamientos: entrenamientos.filter(e => e.fecha),
    evaluaciones: evaluaciones.filter(e => e.fecha),
  }
  const calc = useMemo(() => {
    if (!inicio || !fin || fin < inicio) return null
    try { return computeImpulsaCalendario(config) } catch { return null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicio, fin, festivos, entrenamientos, evaluaciones])

  const addFestivo = () => setFestivos(v => [...v, ''])
  const setFestivo = (i: number, val: string) => setFestivos(v => v.map((x, j) => j === i ? val : x))
  const rmFestivo = (i: number) => setFestivos(v => v.filter((_, j) => j !== i))
  const addFija = (set: any, hora: string) => set((v: Fija[]) => [...v, { fecha: '', horaInicio: hora }])
  const setFija = (set: any, i: number, k: keyof Fija, val: string) => set((v: Fija[]) => v.map((x, j) => j === i ? { ...x, [k]: val } : x))
  const rmFija = (set: any, i: number) => set((v: Fija[]) => v.filter((_, j) => j !== i))

  const puedeCrear = campaign.trim() && salon.trim() && inicio && fin && fin >= inicio && calc && calc.resumen.total > 0

  const crear = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/postgres/impulsa/crear', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign: campaign.trim(), salon: salon.trim(), guia: guia || null, numeroUsuarios: cupos, config }),
      }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      toast.success(`Curso IMPULSA creado — ${res.eventos} eventos materializados`)
      setConfirmar(false)
      // reset mínimo
      setEntrenamientos([]); setEvaluaciones([]); setFestivos([])
    } catch (e: any) { toast.error(e?.message || 'Error al crear') } finally { setSaving(false) }
  }

  const Section = ({ title, children }: { title: string; children: any }) => (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide mb-3">{title}</h3>
      {children}
    </div>
  )

  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.CAMPANA_CREAR} showDefaultMessage>
        <div className="p-6 max-w-5xl mx-auto space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Crear Curso IMPULSA</h1>
            <p className="text-gray-500 text-sm">Calendario <strong>fijo</strong> (sesiones L/M/V 20:00–21:00, entrenamientos y evaluaciones de fecha fija). Se materializa una sola vez al confirmar. Horarios en hora de Chile (America/Santiago).</p>
          </div>

          <Section title="1 · Datos del curso">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <label className="flex flex-col gap-1 text-sm"><span className="text-xs font-medium text-gray-500 uppercase">Campaña</span>
                {nuevaCampaign ? (
                  <div className="flex gap-1">
                    <input value={campaign} onChange={e => setCampaign(e.target.value.toUpperCase())} placeholder="Ej. AGOSTO102026I (IMPULSA → sufijo I)" autoFocus className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1" />
                    <button type="button" onClick={() => { setNuevaCampaign(false); setCampaign('') }} title="Elegir de la lista" className="px-2 text-gray-400 hover:text-gray-600">✕</button>
                  </div>
                ) : (
                  <select value={campaign} onChange={e => { if (e.target.value === '__new__') { setNuevaCampaign(true); setCampaign('') } else setCampaign(e.target.value) }} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    <option value="">— Elige campaña —</option>
                    {campaigns.map(c => <option key={c} value={c}>{c}</option>)}
                    <option value="__new__">➕ Nueva campaña…</option>
                  </select>
                )}</label>
              <label className="flex flex-col gap-1 text-sm"><span className="text-xs font-medium text-gray-500 uppercase">Salón</span>
                <input value={salon} onChange={e => setSalon(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" /></label>
              <label className="flex flex-col gap-1 text-sm"><span className="text-xs font-medium text-gray-500 uppercase">Cupos</span>
                <input type="number" min={1} value={cupos} onChange={e => setCupos(Number(e.target.value) || 0)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" /></label>
              <label className="flex flex-col gap-1 text-sm"><span className="text-xs font-medium text-gray-500 uppercase">Guía (opcional)</span>
                <select value={guia} onChange={e => setGuia(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="">Sin guía</option>
                  {guias.map(g => <option key={g._id} value={g._id}>{g.nombreCompleto}</option>)}
                </select></label>
            </div>
          </Section>

          <Section title="2 · Rango de sesiones (L/M/V · 20:00–21:00)">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
              <label className="flex flex-col gap-1 text-sm"><span className="text-xs font-medium text-gray-500 uppercase">Inicio</span>
                <input type="date" value={inicio} onChange={e => setInicio(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" /></label>
              <label className="flex flex-col gap-1 text-sm"><span className="text-xs font-medium text-gray-500 uppercase">Fin</span>
                <input type="date" value={fin} onChange={e => setFin(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" /></label>
            </div>
          </Section>

          <Section title={`3 · Festivos (se omiten, no se corren) — ${festivos.length}`}>
            <div className="space-y-2">
              {festivos.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="date" value={f} onChange={e => setFestivo(i, e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  <button type="button" onClick={() => rmFestivo(i)} className="text-red-500 text-sm px-2">✕</button>
                </div>
              ))}
              <button type="button" onClick={addFestivo} className="text-sm text-primary-700 font-medium">+ Agregar festivo</button>
            </div>
          </Section>

          <Section title={`4 · Entrenamientos (2h30 · sáb 09:30 / entre semana 18:30) — ${entrenamientos.length}`}>
            <div className="space-y-2">
              {entrenamientos.map((e, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="date" value={e.fecha}
                    onChange={ev => { const f = ev.target.value; setEntrenamientos(v => v.map((x, j) => j === i ? { ...x, fecha: f, horaInicio: f ? defaultEntrenHora(f) : x.horaInicio } : x)) }}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  <input type="time" value={e.horaInicio} onChange={ev => setFija(setEntrenamientos, i, 'horaInicio', ev.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  <button type="button" onClick={() => rmFija(setEntrenamientos, i)} className="text-red-500 text-sm px-2">✕</button>
                </div>
              ))}
              <button type="button" onClick={() => addFija(setEntrenamientos, '')} className="text-sm text-primary-700 font-medium">+ Agregar entrenamiento</button>
            </div>
          </Section>

          <Section title={`5 · Evaluaciones (2h30 · default ${EVAL_HORA_DEFAULT}) — ${evaluaciones.length}`}>
            <div className="space-y-2">
              {evaluaciones.map((e, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="date" value={e.fecha} onChange={ev => setFija(setEvaluaciones, i, 'fecha', ev.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  <input type="time" value={e.horaInicio} onChange={ev => setFija(setEvaluaciones, i, 'horaInicio', ev.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  <button type="button" onClick={() => rmFija(setEvaluaciones, i)} className="text-red-500 text-sm px-2">✕</button>
                </div>
              ))}
              <button type="button" onClick={() => addFija(setEvaluaciones, EVAL_HORA_DEFAULT)} className="text-sm text-primary-700 font-medium">+ Agregar evaluación</button>
            </div>
          </Section>

          {/* Resumen de validación en vivo */}
          <div className="bg-primary-50 border border-primary-200 rounded-xl p-5">
            <h3 className="text-sm font-bold text-primary-800 uppercase tracking-wide mb-3">Resumen de validación</h3>
            {!calc ? (
              <p className="text-sm text-gray-500">Ingresa el rango de fechas para ver el resumen.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
                  {[['Sesiones', calc.resumen.sesiones], ['Entrenamientos', calc.resumen.entrenamientos], ['Evaluaciones', calc.resumen.evaluaciones], ['Total eventos', calc.resumen.total], ['Horas', calc.resumen.horas]].map(([k, v]) => (
                    <div key={k as string} className="bg-white rounded-lg p-3 text-center border border-primary-100">
                      <div className="text-2xl font-extrabold text-primary-700">{v as any}</div>
                      <div className="text-[11px] text-gray-500 uppercase">{k as string}</div>
                    </div>
                  ))}
                </div>
                {calc.resumen.festivosOmitidos.length > 0 && (
                  <p className="text-sm text-amber-700">Festivos omitidos ({calc.resumen.festivosOmitidos.length}): {calc.resumen.festivosOmitidos.join(', ')}</p>
                )}
                {calc.resumen.colisiones.length > 0 && (
                  <div className="text-sm text-orange-700 mt-1">
                    <strong>Colisiones ({calc.resumen.colisiones.length})</strong> — la sesión se omite (gana el evento fijo):
                    <ul className="list-disc ml-5">
                      {calc.resumen.colisiones.map((c, i) => <li key={i}>{c.fecha}: sesión {c.sesion} ↔ {c.evento}</li>)}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex justify-end">
            <button type="button" disabled={!puedeCrear} onClick={() => setConfirmar(true)}
              className="px-5 py-2.5 rounded-lg bg-primary-700 text-white text-sm font-medium hover:bg-primary-800 disabled:opacity-40">
              Crear curso IMPULSA
            </button>
          </div>
        </div>

        {confirmar && calc && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setConfirmar(false)}>
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Confirmar creación</h3>
              <p className="text-sm text-gray-600 mb-3">Se materializará el calendario del curso <strong>IMPULSA</strong> de la campaña <strong>{campaign}</strong> (salón {salon}):</p>
              <ul className="text-sm text-gray-700 space-y-1 mb-4">
                <li>• {calc.resumen.sesiones} sesiones · {calc.resumen.entrenamientos} entrenamientos · {calc.resumen.evaluaciones} evaluaciones</li>
                <li>• {calc.resumen.total} eventos · {calc.resumen.horas} horas</li>
                {calc.resumen.festivosOmitidos.length > 0 && <li>• {calc.resumen.festivosOmitidos.length} festivo(s) omitido(s)</li>}
                {calc.resumen.colisiones.length > 0 && <li>• {calc.resumen.colisiones.length} colisión(es) (sesión absorbida)</li>}
              </ul>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setConfirmar(false)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50">Cancelar</button>
                <button type="button" onClick={crear} disabled={saving} className="px-5 py-2 rounded-lg bg-primary-700 text-white text-sm font-medium hover:bg-primary-800 disabled:opacity-50">{saving ? 'Creando…' : 'Confirmar y crear'}</button>
              </div>
            </div>
          </div>
        )}
      </PermissionGuard>
    </DashboardLayout>
  )
}
