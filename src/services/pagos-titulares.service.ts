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
import { NotFoundError, ValidationError } from '@/lib/errors';

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
  'valorCuota',
  'valorPagado',
  'saldo',
  'descuento',
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

function computeSaldo(valorCuota: any, valorPagado: any, descuento: any): number {
  const s = toNum(valorCuota) - toNum(valorPagado) - toNum(descuento);
  return s < 0 ? 0 : Number(s.toFixed(2));
}

export const pagosTitularesService = {
  async listByPerson(idPeople: string): Promise<PagoTitular[]> {
    if (!idPeople) throw new ValidationError('idPeople requerido');
    return PagosTitularesRepository.findByIdPeople(idPeople);
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

  async validar(id: string, validadoPor: string): Promise<PagoTitular> {
    const existing = await PagosTitularesRepository.findById(id);
    if (!existing) throw new NotFoundError('PAGOS_TITULARES', id);
    if (existing.validado) throw new ValidationError('El pago ya está validado');

    const updated = await PagosTitularesRepository.validar(id, validadoPor);
    if (!updated) throw new ValidationError('No se pudo validar el pago');
    return updated;
  },

  async remove(id: string): Promise<void> {
    const existing = await PagosTitularesRepository.findById(id);
    if (!existing) throw new NotFoundError('PAGOS_TITULARES', id);
    if (existing.validado) {
      throw new ValidationError('No se puede eliminar un pago validado');
    }
    await PagosTitularesRepository.deleteById(id);
  },
};
