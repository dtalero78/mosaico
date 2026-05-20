/**
 * PagosTitulares Service
 *
 * Business rules for PAGOS_TITULARES:
 * - Saldo is computed server-side as `valorCuota - valorPagado - descuento`.
 *   Negative values are clamped to 0.
 * - On create, idPeople MUST exist in PEOPLE; numeroId, plataforma and
 *   gestorRecaudo are auto-inherited from the titular when not provided.
 * - Validation flips `validado` to true and stamps fechaValidacion + validadoPor.
 *   Validated payments cannot be deleted.
 */

import 'server-only';
import { PagosTitularesRepository, type PagoTitular } from '@/repositories/pagos-titulares.repository';
import { PeopleRepository } from '@/repositories/people.repository';
import { ids } from '@/lib/id-generator';
import { query, queryOne } from '@/lib/postgres';
import { NotFoundError, ValidationError } from '@/lib/errors';

const API2PDF_KEY = process.env.API2PDF_KEY || '9450b12a-4c5f-4e8e-a605-2b61fe4807f2';

const UPDATABLE_FIELDS = [
  'gestorRecaudo',
  'plataforma',
  'pagoTercero',
  'idTercero',
  'fechaPago',
  'fechaVencimiento',
  'plan',
  'vlrTotalProg',
  'numCuota',
  'cuotasTotal',
  'valorCuota',
  'valorPagado',
  'saldo',
  'descuento',
  'inscripcion',
  'medioPago',
  'numeroReferencia',
  'numeroFactura',
  'documentosAdjuntos',
];

function toNum(v: any): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function computeSaldo(valorCuota: any, valorPagado: any, descuento: any): number {
  const s = toNum(valorCuota) - toNum(valorPagado) - toNum(descuento);
  return s < 0 ? 0 : Number(s.toFixed(2));
}

/**
 * Sincroniza FINANCIEROS.saldo con la suma de pagos VALIDADOS del titular.
 * Opción 2: sólo los pagos con validado=true cuentan.
 *
 * Best-effort: cualquier error se loggea pero NO se propaga al caller.
 * FINANCIEROS.saldo se guarda como texto (VARCHAR(100) legacy Wix).
 */
export async function syncFinancieroSaldo(idPeople: string): Promise<void> {
  try {
    // 1) Resolver contrato del titular
    const person = await PeopleRepository.findById(idPeople);
    if (!person || !(person as any).contrato) return;
    const contrato = (person as any).contrato as string;

    // 2) Sumar pagos VALIDADOS del titular y contar cuotas pagadas (>0).
    //    - Sum: sólo valorPagado + descuento. La columna `inscripcion` ya está
    //      en valorPagado para cuota #0 (mismo valor) — sumarla doblaría.
    //    - Count cuotasPagadas: validados con numCuota > 0
    //      (la cuota #0 = inscripción NO cuenta como cuota pagada).
    const sumRow = await queryOne<{ total: string; cuotas_pagadas: string }>(
      `SELECT
         COALESCE(SUM(COALESCE("valorPagado", 0) + COALESCE("descuento", 0)), 0)::text AS total,
         COALESCE(SUM(CASE WHEN COALESCE("numCuota", 0) > 0 THEN 1 ELSE 0 END), 0)::text AS cuotas_pagadas
       FROM "PAGOS_TITULARES"
       WHERE "idPeople" = $1 AND "validado" = true`,
      [idPeople]
    );
    const totalValidado = parseFloat(sumRow?.total ?? '0') || 0;
    const cuotasPagadas = parseInt(sumRow?.cuotas_pagadas ?? '0', 10) || 0;

    // 3) Leer totalPlan del FINANCIEROS (texto legacy, hay que parsear)
    const finRow = await queryOne<{ totalPlan: string | null }>(
      `SELECT "totalPlan" FROM "FINANCIEROS" WHERE "contrato" = $1 LIMIT 1`,
      [contrato]
    );
    if (!finRow) return;
    const totalPlan = toNum(finRow.totalPlan);

    // 4) Calcular nuevo saldo (sin negativos)
    const nuevoSaldo = Math.max(0, totalPlan - totalValidado);

    // 5) Update saldo (entero, sin decimales — el frontend parsea con
    //    parseCurrency() que asume punto = separador de miles; ".00" daría
    //    valores 100x más grandes en la tarjeta del resumen). Y cuotasPagadas.
    await query(
      `UPDATE "FINANCIEROS"
       SET "saldo" = $1,
           "cuotasPagadas" = $2,
           "_updatedDate" = NOW()
       WHERE "contrato" = $3`,
      [String(Math.round(nuevoSaldo)), cuotasPagadas, contrato]
    );
  } catch (err: any) {
    console.warn(`[pagos-titulares] syncFinancieroSaldo falló para ${idPeople}:`, err?.message || err);
  }
}

export const pagosTitularesService = {
  async listByPerson(idPeople: string): Promise<PagoTitular[]> {
    if (!idPeople) throw new ValidationError('idPeople requerido');
    return PagosTitularesRepository.findByIdPeople(idPeople);
  },

  /**
   * Lista paginada para el Centro de Validación de Pagos
   * (con JOIN PEOPLE, excluye cuota #0).
   */
  async listForGestion(opts: {
    estado?: 'validado' | 'pendiente';
    fechaDesde?: string | null;
    fechaHasta?: string | null;
    search?: string | null;
    gestorRecaudo?: string | null;
    page?: number;
    pageSize?: number;
  }) {
    const pageSize = Math.min(Math.max(1, opts.pageSize ?? 50), 500);
    const page = Math.max(1, opts.page ?? 1);
    const offset = (page - 1) * pageSize;
    const { rows, total } = await PagosTitularesRepository.findAllWithTitular({
      estado: opts.estado,
      fechaDesde: opts.fechaDesde ?? null,
      fechaHasta: opts.fechaHasta ?? null,
      search: opts.search ?? null,
      gestorRecaudo: opts.gestorRecaudo ?? null,
      limit: pageSize,
      offset,
    });
    return { pagos: rows, total, page, pageSize };
  },

  async getById(id: string): Promise<PagoTitular> {
    const row = await PagosTitularesRepository.findById(id);
    if (!row) throw new NotFoundError('PAGOS_TITULARES', id);
    return row;
  },

  async create(input: Partial<PagoTitular>, createdBy: string): Promise<PagoTitular> {
    if (!input.idPeople) throw new ValidationError('idPeople es requerido');

    const titular = await PeopleRepository.findById(input.idPeople);
    if (!titular) throw new NotFoundError('PEOPLE', input.idPeople);

    if (input.numCuota !== undefined && input.numCuota !== null && Number(input.numCuota) < 0) {
      throw new ValidationError('numCuota debe ser >= 0');
    }

    const saldo = computeSaldo(input.valorCuota, input.valorPagado, input.descuento);

    const data: Partial<PagoTitular> = {
      _id: ids.payment(),
      idPeople: input.idPeople,
      numeroId: input.numeroId ?? (titular as any).numeroId ?? null,
      gestorRecaudo: input.gestorRecaudo ?? (titular as any).gestorRecaudo ?? null,
      plataforma: input.plataforma ?? (titular as any).plataforma ?? null,
      pagoTercero: input.pagoTercero ?? null,
      idTercero: input.idTercero ?? null,
      fechaPago: input.fechaPago ?? new Date().toISOString().slice(0, 10),
      fechaVencimiento: input.fechaVencimiento ?? null,
      plan: input.plan ?? null,
      vlrTotalProg: input.vlrTotalProg ?? null,
      numCuota: input.numCuota ?? null,
      valorCuota: input.valorCuota ?? null,
      valorPagado: input.valorPagado ?? null,
      saldo,
      descuento: input.descuento ?? 0,
      inscripcion: input.inscripcion ?? null,
      medioPago: input.medioPago ?? null,
      numeroReferencia: input.numeroReferencia ?? null,
      numeroFactura: input.numeroFactura ?? null,
      documentosAdjuntos: Array.isArray(input.documentosAdjuntos) ? input.documentosAdjuntos : [],
      validado: false,
      createdBy,
    };

    return PagosTitularesRepository.create(data);
  },

  async update(id: string, body: Record<string, any>): Promise<PagoTitular> {
    const existing = await PagosTitularesRepository.findById(id);
    if (!existing) throw new NotFoundError('PAGOS_TITULARES', id);

    if (existing.validado) {
      throw new ValidationError('No se puede modificar un pago ya validado');
    }

    const next = { ...existing, ...body };
    const saldo = computeSaldo(next.valorCuota, next.valorPagado, next.descuento);
    const payload = { ...body, saldo };

    const updated = await PagosTitularesRepository.updateFields(id, payload, [...UPDATABLE_FIELDS, 'saldo']);
    if (!updated) throw new ValidationError('No se pudieron aplicar los cambios');
    return updated;
  },

  async validar(
    id: string,
    validadoPor: string,
    numeroFactura: string,
    fechaValidacion: string | null = null,
  ): Promise<PagoTitular> {
    const existing = await PagosTitularesRepository.findById(id);
    if (!existing) throw new NotFoundError('PAGOS_TITULARES', id);
    if (existing.validado) throw new ValidationError('El pago ya está validado');

    const factura = (numeroFactura || '').trim();
    if (!factura) throw new ValidationError('Número de factura es requerido para validar');

    const updated = await PagosTitularesRepository.validar(id, validadoPor, factura, fechaValidacion);
    if (!updated) throw new ValidationError('No se pudo validar el pago');

    // Opción 2: el pago acaba de pasar a validado=true → recalcular saldo
    await syncFinancieroSaldo(existing.idPeople);

    return updated;
  },

  /**
   * Elimina un pago.
   * - Pagos pendientes: cualquier rol con `PAGOS_ELIMINAR` puede borrar.
   * - Pagos validados: sólo SUPER_ADMIN / ADMIN. Otros roles reciben error
   *   ("No se puede eliminar un pago validado"). Tras borrar un validado se
   *   recalcula `FINANCIEROS.saldo`/`cuotasPagadas` para que el monto vuelva
   *   al saldo.
   */
  /**
   * Genera el PDF del recibo de pago (LGS-####).
   * - Sólo pagos validados.
   * - Si no tiene numeroRecibo se le asigna uno atómicamente.
   * - Si ya tiene, se reutiliza (idempotente: vuelve a generar el mismo PDF).
   * - HTML inline + API2PDF.
   *
   * Devuelve `{ pdfUrl, numeroRecibo }`.
   */
  async generarRecibo(id: string): Promise<{ pdfUrl: string; numeroRecibo: string }> {
    const pago = await PagosTitularesRepository.findById(id);
    if (!pago) throw new NotFoundError('PAGOS_TITULARES', id);
    if (!pago.validado) throw new ValidationError('Solo se puede generar recibo de pagos validados');

    const titular = await PeopleRepository.findById(pago.idPeople);
    if (!titular) throw new NotFoundError('PEOPLE', pago.idPeople);

    const numeroRecibo = await PagosTitularesRepository.assignNumeroRecibo(id);

    const t: any = titular;
    const nombreCompleto = [t.primerNombre, t.segundoNombre, t.primerApellido, t.segundoApellido]
      .filter(Boolean).join(' ').trim();

    const fmtMoney = (v: any): string => {
      const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0).replace(/[^0-9.\-]/g, ''));
      if (!Number.isFinite(n)) return '$ 0';
      return '$ ' + new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);
    };
    const fmtDate = (d: any): string => {
      if (!d) return '—';
      try { return new Date(d).toLocaleDateString('es-CO', { timeZone: 'UTC' }); } catch { return '—'; }
    };

    const fechaRecibo  = fmtDate(pago.fechaValidacion || pago.fechaPago);
    const valorPagado  = fmtMoney(pago.valorPagado);
    const medioPago    = (pago.medioPago || '—').toString();
    const numCuotaText = pago.numCuota != null ? String(pago.numCuota) : '—';
    const periodo      = fmtDate(pago.fechaVencimiento);
    const recibeConforme = (pago.validadoPor || '—').toString();
    const baseUrl = process.env.NEXTAUTH_URL || 'https://lgs-plataforma.com';
    const logoUrl = `${baseUrl}/logo.png`;

    const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Recibo ${numeroRecibo}</title>
<style>
  @page { margin: 0; size: A4; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; margin: 0; padding: 0; }
  .page { width: 210mm; min-height: 297mm; padding: 0; }
  .header { background: #4f46e5; color: #fff; padding: 28px 40px; display: flex; align-items: center; justify-content: space-between; }
  .header .logo { background: #fff; padding: 12px 16px; border-radius: 6px; display: inline-block; }
  .header .logo img { height: 48px; display: block; }
  .header h1 { font-size: 28pt; margin: 0; letter-spacing: 2px; font-weight: 700; }
  .meta { padding: 36px 60px 12px 60px; text-align: right; font-size: 13pt; }
  .meta .row { margin: 10px 0; }
  .meta .label { color: #555; margin-right: 10px; }
  .meta .value { display: inline-block; min-width: 180px; border-bottom: 1px solid #999; padding: 2px 8px; font-weight: 600; }
  .body { padding: 24px 60px 40px 60px; font-size: 13pt; }
  .field { margin: 22px 0; display: flex; align-items: baseline; gap: 12px; }
  .field .label { white-space: nowrap; color: #333; }
  .field .value { flex: 1; border-bottom: 1px solid #999; padding: 2px 8px; font-weight: 600; min-height: 20px; }
  .field.half { display: inline-flex; width: 48%; }
  .row2 { display: flex; gap: 24px; }
  .row2 > .field { flex: 1; }
  .footer { padding: 80px 60px 40px 60px; text-align: center; }
  .footer .line { width: 320px; margin: 0 auto 8px auto; border-top: 1px solid #333; }
  .footer .caption { font-size: 11pt; color: #444; font-weight: 600; letter-spacing: 0.5px; }
</style>
</head>
<body>
  <div class="page">
    <div class="header">
      <span class="logo"><img src="${logoUrl}" alt="LGS"/></span>
      <h1>RECIBO DE PAGO</h1>
    </div>

    <div class="meta">
      <div class="row"><span class="label">Fecha</span><span class="value">${fechaRecibo}</span></div>
      <div class="row"><span class="label">Recibo N°</span><span class="value">${numeroRecibo}</span></div>
    </div>

    <div class="body">
      <div class="field">
        <span class="label">Recibí de</span>
        <span class="value">${escapeHtml(nombreCompleto || '—')}</span>
      </div>

      <div class="row2">
        <div class="field">
          <span class="label">La suma de</span>
          <span class="value">${valorPagado}</span>
        </div>
        <div class="field">
          <span class="label">Forma de pago</span>
          <span class="value">${escapeHtml(medioPago)}</span>
        </div>
      </div>

      <div class="field">
        <span class="label">Cuota No.</span>
        <span class="value">${escapeHtml(numCuotaText)}</span>
      </div>

      <div class="field">
        <span class="label">Periodo</span>
        <span class="value">${periodo}</span>
      </div>

      <div class="field">
        <span class="label">Recibe conforme</span>
        <span class="value">${escapeHtml(recibeConforme)}</span>
      </div>
    </div>

    <div class="footer">
      <div class="line"></div>
      <div class="caption">Departamento de Recaudos · Let's Go Speak</div>
    </div>
  </div>
</body>
</html>`;

    const pdfRes = await fetch('https://v2018.api2pdf.com/chrome/html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': API2PDF_KEY },
      body: JSON.stringify({
        html: htmlContent,
        fileName: `Recibo_${numeroRecibo}.pdf`,
        inline: false,
        options: { printBackground: true },
      }),
    });
    if (!pdfRes.ok) {
      const err = await pdfRes.text();
      throw new Error(`API2PDF error ${pdfRes.status}: ${err}`);
    }
    const pdfData = await pdfRes.json();
    if (!pdfData.success || !pdfData.pdf) {
      throw new Error(`API2PDF falló: ${pdfData.error || 'Sin URL de PDF'}`);
    }
    return { pdfUrl: pdfData.pdf as string, numeroRecibo };
  },

  async remove(id: string, userRole?: string): Promise<void> {
    const existing = await PagosTitularesRepository.findById(id);
    if (!existing) throw new NotFoundError('PAGOS_TITULARES', id);

    const isAdmin = userRole === 'SUPER_ADMIN' || userRole === 'ADMIN' || userRole === 'admin';
    if (existing.validado && !isAdmin) {
      throw new ValidationError('No se puede eliminar un pago validado');
    }

    await PagosTitularesRepository.deleteById(id);

    // Si el pago borrado estaba validado, hay que recalcular saldo del titular
    if (existing.validado) {
      await syncFinancieroSaldo(existing.idPeople);
    }
  },
};
