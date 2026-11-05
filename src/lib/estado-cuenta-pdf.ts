import 'server-only';
import PDFDocument from 'pdfkit';

/**
 * Generador del "Estado de Cuenta" del titular en PDF (protegido con contraseña).
 *
 * El PDF sale CIFRADO: `userPassword` = número de documento del titular, de modo
 * que sólo quien conozca el documento puede abrirlo. La maquetación es propia de
 * PDFKit (no HTML) para no depender de un servicio externo ni de binarios del
 * sistema (qpdf) — pdfkit trae el cifrado nativo y es JS puro.
 *
 * Lo consume `GET /api/postgres/pagos-titulares/estado-cuenta`.
 */

export interface EstadoCuentaMov {
  n: string;                 // 'CI' (inscripción) o '1','2',… (cuota)
  concepto: string;
  vence: string | null;      // ISO
  pago: string | null;       // ISO (fecha en que pagó) o null
  valor: number;
  canal: string;
  estado: 'Pagado' | 'Parcial' | 'En mora' | 'Por vencer' | 'Pendiente' | 'Descuento';
  /** Cómo se pagó (Pago normal, Pago con abonos, …). Ver src/lib/cuotas-pagos.ts. */
  etiqueta?: string | null;
  /** Abonos que la cubrieron (solo cuotas con 2+ pagos o parciales). */
  detalle?: { fecha: string | null; monto: number; descuento: number }[];
}

export interface EstadoCuentaData {
  modo: 'mes' | 'total';
  mesLabel: string;
  empresa: { razon: string; nit: string };
  logoPath: string | null;       // logo MOSAICO (public/logo-contrato.png)
  firmaPath: string | null;   // firma manuscrita del Jefe de Recaudos (opcional)
  contrato: string;
  corte: string;             // ISO (hoy)
  diaPago: number | null;
  plan: { nombre: string; cuotas: number; valorCuota: number; valorTotal: number; inscripcion: number };
  titular: { nombre: string; documento: string; cel: string; email: string };
  estudiantes: { nombre: string; documento: string; cel: string; programa: string }[];
  cartera: { nombre: string; cargo: string; email: string };
  resumen: { pagado: number; mora: number; porVencer: number; saldo: number; avancePct: number };
  progreso: {
    valorPlan: number;
    pagado: number;
    descuento: number;
    saldo: number;
    progresoPct: number;
    cuotasPagadas: number;
    parcial: number;
    enMora: number;
    porVencer: number;
    // Segmentos en orden: primero la inscripción, luego cada cuota.
    segmentos: Array<'insPagada' | 'insPend' | 'pagada' | 'parcial' | 'mora' | 'porvencer'>;
  };
  movimientos: EstadoCuentaMov[];
  proximoPago: EstadoCuentaMov | null;
  ultimoPago: EstadoCuentaMov | null;
  password: string;          // documento del titular
}

// Paleta MOSAICO (tailwind.config.js: primary morado + accent fucsia, y los tonos
// del degradado del logo: naranja → fucsia → morado).
const C = {
  brand: '#3b1d8a',       // morado MOSAICO (banda del encabezado)
  brandDark: '#2c1568',   // morado oscuro (títulos, tabla, cifras)
  accent: '#c026d3',      // fucsia MOSAICO
  orange: '#f39200',      // naranja del logo
  ink: '#111827',
  sub: '#6b7280',
  line: '#e5e7eb',
  soft: '#f3f0fb',        // morado muy claro (tarjetas)
  green: '#047857',
  greenBg: '#ecfdf5',
  red: '#b91c1c',
  redBg: '#fef2f2',
  amber: '#b45309',
  amberBg: '#fffbeb',
  gray: '#4b5563',
  grayBg: '#f3f4f6',
};

const money = (n: number) => {
  const r = Math.round(n || 0);
  const abs = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Math.abs(r));
  return (r < 0 ? '-$ ' : '$ ') + abs;
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
};

const ESTADO_STYLE: Record<string, { fg: string; bg: string }> = {
  Pagado:      { fg: C.green,     bg: C.greenBg },
  Parcial:     { fg: C.brandDark, bg: C.soft },
  'En mora':   { fg: C.red,       bg: C.redBg },
  'Por vencer':{ fg: C.amber,     bg: C.amberBg },
  Pendiente:   { fg: C.gray,      bg: C.grayBg },
  Descuento:   { fg: C.gray,      bg: C.grayBg },
};

const MARGIN = 40;
const PAGE_W = 595.28;
const CONTENT_W = PAGE_W - MARGIN * 2;

// Columnas de la tabla de movimientos (suman CONTENT_W = 515.28)
const COLS = [
  { key: 'n',        label: '#',        w: 22,  align: 'center' as const },
  { key: 'concepto', label: 'Concepto', w: 116, align: 'left'   as const },
  { key: 'vence',    label: 'Vence',    w: 54,  align: 'center' as const },
  { key: 'pago',     label: 'Pago',     w: 54,  align: 'center' as const },
  { key: 'valor',    label: 'Valor',    w: 64,  align: 'right'  as const },
  { key: 'canal',    label: 'Canal',    w: 149, align: 'left'   as const },
  { key: 'estado',   label: 'Estado',   w: 56.28, align: 'center' as const },
];

export async function buildEstadoCuentaPdf(data: EstadoCuentaData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: MARGIN,
        bufferPages: true,           // requerido para el pie de página en todas las páginas
        pdfVersion: '1.7',           // AES-128
        userPassword: data.password || undefined,
        ownerPassword: `MOS-${data.contrato}-${Date.now()}`,
        permissions: { printing: 'highResolution', copying: false, modifying: false },
        info: {
          Title: `Estado de Cuenta ${data.contrato}`,
          Author: data.empresa.razon,
          Subject: `Estado de cuenta — ${data.titular.nombre}`,
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      renderHeader(doc, data);
      renderInfoBlocks(doc, data);
      renderProgreso(doc, data);
      if (data.modo === 'mes') renderProximoUltimo(doc, data);
      renderMovimientos(doc, data);
      renderFirma(doc, data);
      renderFooters(doc, data);

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ─── Header (banda morada MOSAICO + logo + título) ────────────────────────
function renderHeader(doc: any, data: EstadoCuentaData) {
  const H = 96;
  doc.rect(0, 0, PAGE_W, H).fill(C.brand);
  // Filete fucsia bajo la banda: el acento de la marca.
  doc.rect(0, H, PAGE_W, 4).fill(C.accent);
  // Logo MOSAICO (círculo degradado) sobre una ficha blanca + nombre de la marca.
  const chip = 60;
  doc.roundedRect(MARGIN, 18, chip, chip, 8).fill('#ffffff');
  if (data.logoPath) {
    try { doc.image(data.logoPath, MARGIN + 6, 24, { fit: [chip - 12, chip - 12], align: 'center', valign: 'center' }); } catch { /* logo opcional */ }
  }
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('MOSAICO', MARGIN + chip + 12, 40, { lineBreak: false });

  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20)
    .text('ESTADO DE CUENTA', MARGIN, 24, { width: CONTENT_W, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor('#e6ddf7')
    .text(
      `${data.empresa.razon}${data.empresa.nit ? '  ·  NIT ' + data.empresa.nit : ''}`,
      MARGIN, 50, { width: CONTENT_W, align: 'right' },
    );
  doc.fontSize(9).fillColor('#ffffff')
    .text(
      `Contrato ${data.contrato}   ·   Corte ${fmtDate(data.corte)}   ·   ${data.modo === 'mes' ? data.mesLabel : 'Consolidado total'}`,
      MARGIN, 66, { width: CONTENT_W, align: 'right' },
    );
  doc.y = H + 20;
  doc.fillColor(C.ink);
}

// ─── Bloques Titular / Estudiantes / Plan ──────────────────────────────────
function renderInfoBlocks(doc: any, data: EstadoCuentaData) {
  const top = doc.y;
  const colW = (CONTENT_W - 16) / 2;

  // Titular (izq)
  doc.roundedRect(MARGIN, top, colW, 78, 6).fill(C.soft);
  doc.fillColor(C.brandDark).font('Helvetica-Bold').fontSize(9).text('TITULAR', MARGIN + 12, top + 10);
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(11).text(data.titular.nombre || '—', MARGIN + 12, top + 24, { width: colW - 24 });
  doc.font('Helvetica').fontSize(8.5).fillColor(C.sub)
    .text(`Documento: ${data.titular.documento || '—'}`, MARGIN + 12, top + 42, { width: colW - 24 })
    .text(`Cel: ${data.titular.cel || '—'}`, MARGIN + 12, top + 54, { width: colW - 24 })
    .text(`Email: ${data.titular.email || '—'}`, MARGIN + 12, top + 66, { width: colW - 24 });

  // Plan (der)
  const rx = MARGIN + colW + 16;
  doc.roundedRect(rx, top, colW, 78, 6).fill(C.grayBg);
  doc.fillColor(C.brandDark).font('Helvetica-Bold').fontSize(9).text('PLAN', rx + 12, top + 10);
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(11).text(data.plan.nombre || 'Plan', rx + 12, top + 24, { width: colW - 24 });
  doc.font('Helvetica').fontSize(8.5).fillColor(C.sub)
    .text(`Valor total: ${money(data.plan.valorTotal)}   ·   Inscripción: ${money(data.plan.inscripcion)}`, rx + 12, top + 42, { width: colW - 24 })
    .text(`Cuotas: ${data.plan.cuotas}  x  ${money(data.plan.valorCuota)}`, rx + 12, top + 54, { width: colW - 24 })
    .text(`Corte de pago: ${data.diaPago ? 'día ' + data.diaPago + ' de cada mes' : '—'}`, rx + 12, top + 66, { width: colW - 24 });

  doc.y = top + 78 + 12;

  // Estudiantes (lista compacta)
  if (data.estudiantes.length) {
    doc.fillColor(C.brandDark).font('Helvetica-Bold').fontSize(9).text('BENEFICIARIOS', MARGIN, doc.y);
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(8.5).fillColor(C.gray);
    for (const e of data.estudiantes) {
      const linea = `•  ${e.nombre}${e.documento ? ' · ' + e.documento : ''}${e.programa ? ' · ' + e.programa : ''}`;
      doc.text(linea, MARGIN + 4, doc.y, { width: CONTENT_W - 4 });
    }
    doc.moveDown(0.6);
  }
  doc.fillColor(C.ink);
}

// ─── Indicador de pago (barra segmentada + leyenda + cifras) ───────────────
const FUCSIA = C.accent, FUCSIA_SOFT = '#fae8ff';
const MORADO = C.brand;
const MORA_FILL = '#fee2e2', MORA_BORDER = '#dc2626';
const PV_FILL = '#eef2f7', PV_BORDER = '#cbd5e1';

// Estilo por tipo de segmento: fill sólido, o fill claro + borde.
const SEG_STYLE: Record<string, { fill: string; border?: string }> = {
  insPagada:  { fill: FUCSIA },
  insPend:    { fill: FUCSIA_SOFT, border: FUCSIA },
  pagada:     { fill: MORADO },
  parcial:    { fill: C.orange },   // naranja del logo = abono parcial (cuota no cubierta al 100%)
  mora:       { fill: MORA_FILL, border: MORA_BORDER },
  porvencer:  { fill: PV_FILL, border: PV_BORDER },
};

function drawChip(doc: any, x: number, y: number, w: number, h: number, r: number, style: { fill: string; border?: string }) {
  if (style.border) {
    doc.lineWidth(1).roundedRect(x, y, w, h, r).fillAndStroke(style.fill, style.border);
  } else {
    doc.roundedRect(x, y, w, h, r).fill(style.fill);
  }
}

function renderProgreso(doc: any, data: EstadoCuentaData) {
  const p = data.progreso;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.brandDark).text('PROGRESO DE PAGO', MARGIN, doc.y);
  doc.moveDown(0.3);

  // ── Barra de segmentos (inscripción + cada cuota) ──
  const gap = 5, segH = 15;
  const n = Math.max(1, p.segmentos.length);
  let segW = (CONTENT_W - gap * (n - 1)) / n;
  if (segW > 34) segW = 34;
  if (segW < 9) segW = 9;
  let x = MARGIN;
  let y = doc.y;
  for (const s of p.segmentos) {
    if (x + segW > MARGIN + CONTENT_W + 0.5) { x = MARGIN; y += segH + 5; }
    drawChip(doc, x, y, segW, segH, 3, SEG_STYLE[s] || SEG_STYLE.porvencer);
    x += segW + gap;
  }
  y += segH + 10;
  doc.fillColor(C.ink);

  // ── Leyenda ──
  const legend: Array<{ style: { fill: string; border?: string }; label: string }> = [
    { style: SEG_STYLE.insPagada, label: 'Inscripción' },
    { style: SEG_STYLE.pagada, label: `Cuotas pagadas (${p.cuotasPagadas})` },
  ];
  if (p.parcial > 0) legend.push({ style: SEG_STYLE.parcial, label: `Parcial (${p.parcial})` });
  if (p.enMora > 0) legend.push({ style: SEG_STYLE.mora, label: `En mora (${p.enMora})` });
  if (p.porVencer > 0) legend.push({ style: SEG_STYLE.porvencer, label: `Por vencer (${p.porVencer})` });

  let lx = MARGIN;
  doc.font('Helvetica').fontSize(8).fillColor(C.gray);
  for (const item of legend) {
    drawChip(doc, lx, y + 1, 11, 11, 2, item.style);
    doc.fillColor(C.gray).text(item.label, lx + 15, y + 2, { lineBreak: false });
    lx += 15 + doc.widthOfString(item.label) + 18;
  }
  y += 24;

  // ── Cifras: Valor del plan · Pagado · Saldo · Progreso de Pago ──
  const figs = [
    { label: 'Valor del plan', val: money(p.valorPlan) },
    { label: 'Pagado', val: money(p.pagado) },
    ...(p.descuento > 0 ? [{ label: 'Descuento', val: money(p.descuento) }] : []),
    { label: 'Saldo', val: money(p.saldo) },
    { label: 'Progreso de Pago', val: `${Math.round(p.progresoPct)}%` },
  ];
  const fw = CONTENT_W / figs.length;
  figs.forEach((f, i) => {
    const fx = MARGIN + i * fw;
    doc.font('Helvetica').fontSize(8).fillColor(C.sub).text(f.label, fx, y, { width: fw - 6 });
    doc.font('Helvetica-Bold').fontSize(13).fillColor(C.brandDark).text(f.val, fx, y + 12, { width: fw - 6 });
  });
  doc.y = y + 34;
  doc.fillColor(C.ink);
}

// ─── Próximo / Último pago (solo modo mes) ─────────────────────────────────
function renderProximoUltimo(doc: any, data: EstadoCuentaData) {
  const colW = (CONTENT_W - 16) / 2;
  const top = doc.y;
  const box = (x: number, titulo: string, mov: EstadoCuentaMov | null, tint: string) => {
    doc.roundedRect(x, top, colW, 52, 6).fill(tint);
    doc.fillColor(C.brandDark).font('Helvetica-Bold').fontSize(8.5).text(titulo, x + 12, top + 9);
    if (mov) {
      doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(10).text(`${mov.concepto} · ${money(mov.valor)}`, x + 12, top + 22, { width: colW - 24 });
      doc.font('Helvetica').fontSize(8.5).fillColor(C.sub)
        .text(mov.pago ? `Pagado el ${fmtDate(mov.pago)}` : `Vence el ${fmtDate(mov.vence)} · ${mov.estado}`, x + 12, top + 36, { width: colW - 24 });
    } else {
      doc.fillColor(C.sub).font('Helvetica').fontSize(9).text('—', x + 12, top + 24);
    }
  };
  box(MARGIN, 'PRÓXIMO PAGO', data.proximoPago, C.amberBg);
  box(MARGIN + colW + 16, 'ÚLTIMO PAGO', data.ultimoPago, C.greenBg);
  doc.y = top + 52 + 16;
  doc.fillColor(C.ink);
}

// ─── Tabla de movimientos (con paginación) ─────────────────────────────────
function tableHeader(doc: any): number {
  const top = doc.y;
  doc.rect(MARGIN, top, CONTENT_W, 20).fill(C.brandDark);
  let x = MARGIN;
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
  for (const c of COLS) {
    doc.text(c.label, x + 5, top + 6, { width: c.w - 10, align: c.align });
    x += c.w;
  }
  doc.fillColor(C.ink);
  return top + 20;
}

function renderMovimientos(doc: any, data: EstadoCuentaData) {
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.brandDark)
    .text(data.modo === 'mes' ? `Movimientos · ${data.mesLabel}` : 'Historial de movimientos', MARGIN, doc.y);
  doc.moveDown(0.4);
  doc.fillColor(C.ink);

  let y = tableHeader(doc);
  const bottomLimit = 780;
  const rowH = 19;

  if (!data.movimientos.length) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(C.sub)
      .text('No hay movimientos para el período seleccionado.', MARGIN + 6, y + 6);
    doc.y = y + 26;
    doc.fillColor(C.ink);
    return;
  }

  const subH = 13;
  // Segunda línea: "Pago con abonos: 05/02/2026 $45.000 · 20/02/2026 $45.000 (desc. $5.000)"
  const subLinea = (m: EstadoCuentaMov): string | null => {
    if (!m.etiqueta) return null;
    const abonos = (m.detalle || []).map(a =>
      `${fmtDate(a.fecha)} ${money(a.monto)}${a.descuento > 0.5 ? ` (desc. ${money(a.descuento)})` : ''}`);
    return abonos.length ? `${m.etiqueta}: ${abonos.join(' · ')}` : m.etiqueta;
  };

  data.movimientos.forEach((m, idx) => {
    const sub = subLinea(m);
    const alto = rowH + (sub ? subH : 0);
    if (y + alto > bottomLimit) {
      doc.addPage();
      doc.y = MARGIN;
      y = tableHeader(doc);
    }
    if (idx % 2 === 1) doc.rect(MARGIN, y, CONTENT_W, alto).fill('#fafafa');

    let x = MARGIN;
    const cell = (txt: string, w: number, align: 'left' | 'center' | 'right', bold = false, color = C.ink) => {
      doc.fillColor(color).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      const maxW = w - 10;
      // Recorte propio a UNA sola línea (el ellipsis de PDFKit con lineBreak:false
      // no es fiable y dejaba envolver el texto largo del Canal, pisando la fila).
      let s = (txt == null ? '' : String(txt)) || '—';
      if (doc.widthOfString(s) > maxW) {
        while (s.length > 1 && doc.widthOfString(s + '…') > maxW) s = s.slice(0, -1);
        s = s.replace(/\s+$/, '') + '…';
      }
      doc.text(s, x + 5, y + 5.5, { width: maxW, align, lineBreak: false });
      x += w;
    };
    cell(m.n, COLS[0].w, 'center');
    cell(m.concepto, COLS[1].w, 'left');
    cell(fmtDate(m.vence), COLS[2].w, 'center');
    cell(fmtDate(m.pago), COLS[3].w, 'center');
    cell(money(m.valor), COLS[4].w, 'right', true);
    cell(m.canal || '—', COLS[5].w, 'left', false, C.sub);
    // Estado como chip
    const st = ESTADO_STYLE[m.estado] || ESTADO_STYLE.Pendiente;
    const chipW = COLS[6].w - 10;
    doc.roundedRect(x + 5, y + 3.5, chipW, 12, 3).fill(st.bg);
    doc.fillColor(st.fg).font('Helvetica-Bold').fontSize(6.5)
      .text(m.estado.toUpperCase(), x + 5, y + 6, { width: chipW, align: 'center', lineBreak: false });
    doc.fillColor(C.ink);

    y += rowH;
    if (sub) {
      const subX = MARGIN + COLS[0].w + 5;
      const subW = CONTENT_W - COLS[0].w - 10;
      let s = sub;
      doc.font('Helvetica-Oblique').fontSize(7);
      if (doc.widthOfString(s) > subW) {
        while (s.length > 1 && doc.widthOfString(s + '…') > subW) s = s.slice(0, -1);
        s = s.replace(/\s+$/, '') + '…';
      }
      doc.fillColor(m.estado === 'Parcial' ? C.brandDark : C.green)
        .text(s, subX, y - 2, { width: subW, lineBreak: false });
      doc.fillColor(C.ink);
      y += subH;
    }
    doc.strokeColor(C.line).lineWidth(0.5).moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).stroke();
  });
  doc.y = y + 14;
  doc.fillColor(C.ink);
}

// ─── Firma (jefe de recaudos según país) + nota de contraseña ──────────────
function renderFirma(doc: any, data: EstadoCuentaData) {
  if (doc.y + 96 > 806) { doc.addPage(); doc.y = MARGIN; }
  const top = doc.y + 6;
  doc.strokeColor(C.line).lineWidth(1).moveTo(MARGIN, top).lineTo(MARGIN + CONTENT_W, top).stroke();

  const y = top + 14;
  // Firma manuscrita (imagen) apoyada sobre la línea, si está disponible
  if (data.firmaPath) {
    try { doc.image(data.firmaPath, MARGIN, top + 2, { fit: [190, 44] }); } catch { /* firma opcional */ }
  }
  // Línea de firma + datos del Jefe de Recaudos
  doc.strokeColor(C.ink).lineWidth(0.8).moveTo(MARGIN, y + 24).lineTo(MARGIN + 200, y + 24).stroke();
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(10).text(data.cartera.nombre || '—', MARGIN, y + 28);
  doc.font('Helvetica').fontSize(8.5).fillColor(C.sub)
    .text(data.cartera.cargo || 'Recaudos', MARGIN, y + 42)
    .text(data.cartera.email || '', MARGIN, y + 54);

  // Nota contraseña (der)
  const rx = MARGIN + CONTENT_W - 230;
  doc.roundedRect(rx, y - 4, 230, 62, 6).fill(C.soft);
  doc.fillColor(C.brandDark).font('Helvetica-Bold').fontSize(8.5).text('DOCUMENTO PROTEGIDO', rx + 12, y + 6, { width: 206 });
  doc.font('Helvetica').fontSize(8).fillColor(C.gray)
    .text('Este PDF está cifrado. La contraseña para abrirlo es el número de documento del titular.', rx + 12, y + 20, { width: 206 });
  doc.y = y + 70;
  doc.fillColor(C.ink);
}

// ─── Pie de página en todas las páginas ────────────────────────────────────
function renderFooters(doc: any, data: EstadoCuentaData) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // El pie va en y=818, por DEBAJO del margen inferior (alto − 40 = 801.89).
    // PDFKit, al escribir texto más allá de `maxY`, "continúa" en una página
    // nueva → generaba páginas en blanco. Anular el margen inferior de la página
    // (maxY = alto) evita esa continuación. `lineBreak:false` como defensa extra.
    doc.page.margins.bottom = 0;
    doc.strokeColor(C.line).lineWidth(0.5).moveTo(MARGIN, 812).lineTo(MARGIN + CONTENT_W, 812).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(C.sub)
      .text(
        `${data.empresa.razon} · Estado de cuenta generado el ${fmtDate(data.corte)}`,
        MARGIN, 818, { width: CONTENT_W - 60, align: 'left', lineBreak: false },
      );
    doc.text(`Página ${i - range.start + 1} de ${range.count}`, MARGIN + CONTENT_W - 60, 818, { width: 60, align: 'right', lineBreak: false });
  }
}
