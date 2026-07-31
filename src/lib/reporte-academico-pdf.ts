import 'server-only';
import { METRICAS } from '@/services/reporte-academico.service';

/** Datos de un estudiante para el informe individual (subset del row del servicio). */
export interface ReporteIndividualRow {
  nombre: string; numeroId?: string; plataforma?: string;
  apoderado?: string; nivel?: string; step?: string;
  sesSemana: number;
  metricas: Record<string, { cumplidas: number; sesiones: number; estado: string }>;
  asistidasCurso: number; totalCurso: number; asistenciaCursoPct: number; progresoPct: number;
  comentarioIA?: string; notaGuia?: string;
}
export interface ReporteIndividualMeta {
  curso: string; salon: string; guiaNombre: string; semanaInicio: string; semanaFin: string;
}

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fecha = (iso: string) => { try { return new Date(iso + 'T12:00:00Z').toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return iso; } }

function oval(estado: string): string {
  const base = 'display:inline-block;width:30px;height:19px;border-radius:99px;vertical-align:middle;border:2px solid transparent;';
  if (estado === 'full') return `<span style="${base}background:linear-gradient(120deg,#6d28d9,#c026d3)"></span>`;
  if (estado === 'half') return `<span style="${base}background:linear-gradient(90deg,#6d28d9 0 50%,#fff 50% 100%);border-color:#c026d3"></span>`;
  if (estado === 'empty') return `<span style="${base}border-color:#dc2626"></span>`;
  return `<span style="${base}border:2px dashed #c9c2d6"></span>`;
}

/** HTML autocontenido (imprimible) del informe individual de un estudiante. */
export function buildReporteIndividualHtml(row: ReporteIndividualRow, meta: ReporteIndividualMeta): string {
  const finMenos1 = (() => { try { return new Date(new Date(meta.semanaFin + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10); } catch { return meta.semanaFin; } })();
  const grupos: Record<string, typeof METRICAS[number][]> = { 'HÁBITOS': [], 'DESEMPEÑO': [], 'ACTITUDES': [] };
  for (const m of METRICAS) grupos[m.grupo].push(m);
  const colorGrupo: Record<string, string> = { 'HÁBITOS': '#6d28d9', 'DESEMPEÑO': '#c026d3', 'ACTITUDES': '#0891b2' };

  const filasMetricas = Object.entries(grupos).map(([g, ms]) => `
    <tr><td colspan="3" style="padding:10px 8px 4px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:${colorGrupo[g]};font-weight:700">${g}</td></tr>
    ${ms.map((m) => {
      const x = row.metricas[m.key] || { cumplidas: 0, sesiones: row.sesSemana, estado: 'none' };
      return `<tr>
        <td style="padding:6px 8px;font-size:13px;border-bottom:1px solid #eee">${esc(m.label)}</td>
        <td style="padding:6px 8px;text-align:center;border-bottom:1px solid #eee">${oval(x.estado)}</td>
        <td style="padding:6px 8px;text-align:right;font-size:12px;color:#6b6480;border-bottom:1px solid #eee">${x.cumplidas}/${row.sesSemana}</td>
      </tr>`;
    }).join('')}`).join('');

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{margin:0;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1d1630;font-size:13px}
    .wrap{padding:26px 30px}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #4c1d95;padding-bottom:14px;margin-bottom:16px}
    .logo{width:44px;height:44px;border-radius:12px;background:conic-gradient(from 210deg,#f59e0b,#c026d3,#6d28d9,#f59e0b);color:#fff;font-weight:800;font-size:20px;display:flex;align-items:center;justify-content:center}
    .brand{display:flex;gap:11px;align-items:center}
    .brand .t1{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:#6d28d9;font-weight:700}
    .brand .t2{font-size:11px;color:#6b6480}
    .rt{text-align:right}
    .rt .k{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#6b6480}
    .rt h2{margin:2px 0 0;font-size:19px}
    .rt .m{font-size:11px;color:#6b6480;margin-top:3px}
    .stu{font-size:20px;font-weight:800;margin:2px 0}
    .stu small{font-size:12px;color:#6b6480;font-weight:500}
    .kpis{display:flex;gap:10px;margin:14px 0}
    .kpi{flex:1;border:1px solid #e9e4f2;border-radius:12px;padding:10px 12px}
    .kpi .l{font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;color:#6b6480;font-weight:600}
    .kpi .v{font-size:22px;font-weight:800}
    .kpi .v.a{color:#c026d3}
    table{border-collapse:collapse;width:100%}
    .box{border:1px solid #e9e4f2;border-radius:12px;padding:12px 14px;margin-top:12px}
    .box h4{margin:0 0 6px;font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:#6b6480}
    .box p{margin:0;font-size:13px;white-space:pre-wrap}
    .legend{display:flex;gap:14px;font-size:11px;color:#6b6480;margin-top:8px}
    .legend span{display:inline-flex;align-items:center;gap:6px}
  </style></head><body><div class="wrap">
    <div class="head">
      <div class="brand"><div class="logo">M</div><div><div class="t1">MOSAICO · + que Matemáticas</div><div class="t2">Reporte Académico individual</div></div></div>
      <div class="rt"><div class="k">Semana</div><h2>${esc(fecha(meta.semanaInicio))} – ${esc(fecha(finMenos1))}</h2><div class="m">${esc(meta.curso)} · Salón ${esc(meta.salon)} · Guía: ${esc(meta.guiaNombre)}</div></div>
    </div>

    <div class="stu">${esc(row.nombre)} <small>· ID ${esc(row.numeroId || '')} · ${esc(row.plataforma || '')}</small></div>
    <div style="font-size:12px;color:#6b6480">Módulo ${esc(row.nivel || '')} · ${esc(row.step || '')}</div>

    <div class="kpis">
      <div class="kpi"><div class="l">Sesiones de la semana</div><div class="v">${row.sesSemana}</div></div>
      <div class="kpi"><div class="l">Asistencia del curso</div><div class="v a">${row.asistenciaCursoPct}%</div></div>
      <div class="kpi"><div class="l">Progreso del curso</div><div class="v">${row.progresoPct}%</div></div>
    </div>

    <div class="box" style="padding:6px 14px">
      <table>${filasMetricas}</table>
      <div class="legend">
        <span>${oval('full')} Cumplió todas</span><span>${oval('half')} Algunas</span><span>${oval('empty')} No cumplió</span><span>${oval('none')} Sin sesión</span>
      </div>
    </div>

    ${row.comentarioIA ? `<div class="box"><h4>Comentario</h4><p>${esc(row.comentarioIA)}</p></div>` : ''}
    ${row.notaGuia ? `<div class="box"><h4>Valoración del Guía</h4><p>${esc(row.notaGuia)}</p></div>` : ''}
  </div></body></html>`;
}
