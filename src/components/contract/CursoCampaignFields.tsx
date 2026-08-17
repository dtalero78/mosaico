'use client'



/**
 * Cascada Campaña → Curso → Horario (+ Salón / Final del curso / userLogin) sobre
 * CURSOS_CAMPAIGN. Componente compartido por Crear Contrato y Migrar Contrato.
 */

export interface CursoRow {
  campaign: string;
  tipoCurso: string;
  horarioCurso: string;
  paraMenores: boolean;
  numeroUsuarios?: number;
  usuInscritos?: number;
  salon?: string | null;
  inicioCurso?: string | null;
  finalCurso?: string | null;
  finalCampaign?: string | null;
}

export default function CursoCampaignFields({
  rows, values, onPatch, esImpulsa = false, userLogin,
}: {
  rows: CursoRow[];
  values: { campaign?: string; tipoCurso?: string; horarioCurso?: string };
  onPatch: (patch: { campaign?: string; tipoCurso?: string; horarioCurso?: string }) => void;
  esImpulsa?: boolean;
  userLogin?: string;
}) {
  const campaign = values.campaign || '';
  const tipoCurso = values.tipoCurso || '';
  const horarioCurso = values.horarioCurso || '';
  const campaigns = Array.from(new Set(rows.map(r => r.campaign)));
  const cursos = Array.from(new Set(
    rows.filter(r => r.campaign === campaign && (esImpulsa ? r.tipoCurso === 'IMPULSA' : r.tipoCurso !== 'IMPULSA')).map(r => r.tipoCurso)
  ));
  const horarioRows = rows.filter(r => r.campaign === campaign && r.tipoCurso === tipoCurso);
  const selectedRow = horarioRows.find(r => r.horarioCurso === horarioCurso);
  // ¿Algún salón de este curso está sin cupo? Se avisa debajo del dropdown para
  // que se entienda qué significa el "SIN CUPO (provisional)" de las opciones.
  const hayLlenos = horarioRows.some(r => {
    const cap = r.numeroUsuarios ?? 0;
    return cap > 0 && cap - (r.usuInscritos ?? 0) <= 0;
  });
  const fmtDate = (d?: string | null) => (d ? String(d).slice(0, 10) : '—');
  const sel = 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:cursor-not-allowed';
  const lbl = 'block text-sm font-medium text-gray-700 mb-1';
  return (
    <>
      <div>
        <label className={lbl}>Campaña *</label>
        <select className={sel} value={campaign}
          onChange={(e) => onPatch({ campaign: e.target.value, tipoCurso: '', horarioCurso: '' })}>
          <option value="">Seleccionar...</option>
          {campaigns.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label className={lbl}>Tipo de Curso *</label>
        <select className={sel} value={tipoCurso} disabled={!campaign}
          onChange={(e) => onPatch({ tipoCurso: e.target.value, horarioCurso: '' })}>
          <option value="">Seleccionar...</option>
          {cursos.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label className={lbl}>Horario *</label>
        <select className={sel} value={horarioCurso} disabled={!tipoCurso}
          onChange={(e) => onPatch({ horarioCurso: e.target.value })}>
          <option value="">Seleccionar...</option>
          {horarioRows.map(r => {
            const cap = r.numeroUsuarios ?? 0;
            const cupos = cap - (r.usuInscritos ?? 0);
            const full = cap > 0 && cupos <= 0;
            // El cupo es POR SALÓN (cada fila de CURSOS_CAMPAIGN es un salón).
            // Se marca el que está lleno pero NO se deshabilita: al crear el
            // contrato el curso es provisional y el asiento aún no se reserva.
            // El cupo se comprueba al dejar el contrato listo, y ahí se ofrece
            // cambiar de horario. Bloquear aquí frenaría ventas por un salón
            // que puede haberse liberado para cuando se cierre el contrato.
            return (
              <option key={r.horarioCurso} value={r.horarioCurso}>
                {r.horarioCurso}{r.salon ? ` · Salón ${r.salon}` : ''} — {full ? 'SIN CUPO (provisional)' : `${cupos} cupos`}
              </option>
            );
          })}
        </select>
        {hayLlenos && (
          <p className="mt-1 text-xs text-amber-600">
            Hay salones sin cupo. Se pueden elegir igual —el cupo se reserva al dejar
            el contrato listo—, pero si sigue lleno habrá que cambiar de horario.
          </p>
        )}
      </div>
      {selectedRow && (
        <>
          <div>
            <label className={lbl}>Salón</label>
            <input type="text" value={selectedRow.salon || '—'} disabled className={sel} />
          </div>
          <div>
            <label className={lbl}>Final del curso</label>
            <input type="text" value={fmtDate(selectedRow.finalCurso)} disabled className={sel} />
          </div>
          <div>
            <label className={lbl}>Usuario (userLogin)</label>
            <input type="text" value={userLogin || '—'} disabled className={`${sel} font-mono tracking-wide`} title="Usuario de login generado automáticamente" />
          </div>
        </>
      )}
    </>
  );
}
