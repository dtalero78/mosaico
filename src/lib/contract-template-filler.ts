/**
 * Contract Template Filler
 *
 * Shared pure function for replacing {{placeholder}} tokens in contract templates.
 * Used by both the admin contract detail page and the public contract page.
 * No 'server-only' import — safe for client-side use.
 */

export interface ConsentDisplay {
  hasConsent: boolean;
  consent?: {
    numeroDocumento?: string;
    timestampAcceptacion?: string;
    ipAddress?: string;
    celularValidado?: string;
    tipoAprobacion?: string;
  } | null;
  hash?: string | null;
}

/** Format any date value (Date object, ISO string, or YYYY-MM-DD) to Spanish long date. */
function fmtDate(value: any): string {
  if (!value) return '';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return String(value);
  }
}

/**
 * Fill a contract template with data, replacing {{placeholder}} tokens.
 * Mirrors the Wix TemplateManager.buildData + fillTemplate logic.
 */
export interface EjecutivoComercialInfo {
  nombre?: string;
  email?: string;
}

export function fillContractTemplate(
  template: string,
  titular: any,
  beneficiarios: any[],
  financial: any,
  consentData?: ConsentDisplay,
  ejecutivoComercial?: EjecutivoComercialInfo | null,
): string {
  // Build beneficiarios text block
  const beneficiariosText = beneficiarios.length === 0
    ? ''
    : beneficiarios.map((b: any, i: number) =>
        `Beneficiario ${i + 1}:\n` +
        `- Numero de Contrato: ${b.contrato || 'Sin asignar'}\n` +
        `- Nombre Completo: ${[b.primerNombre, b.segundoNombre, b.primerApellido, b.segundoApellido].filter(Boolean).join(' ')}\n` +
        `- Documento: ${b.numeroId || ''}\n` +
        `- Fecha de nacimiento: ${fmtDate(b.fechaNacimiento)}\n` +
        `- Telefono: ${b.celular || ''}\n` +
        `- Pais: ${b.plataforma || ''}\n` +
        `- Ciudad: ${b.ciudad || ''}\n` +
        `- Domicilio: ${b.domicilio || ''}\n` +
        `- Email: ${b.email || ''}`
      ).join('\n\n');

  // Build firma (consent) text
  let firmaText = '';
  if (consentData?.hasConsent && consentData.consent) {
    const c = consentData.consent;
    const fecha = c.timestampAcceptacion
      ? new Date(c.timestampAcceptacion).toLocaleString('es-CO')
      : '';
    const tipo = c.tipoAprobacion === 'AUTOMATICA' ? ' (Aprobacion Automatica)' : '';

    const ejecutivoLineas =
      (ejecutivoComercial && (ejecutivoComercial.nombre || ejecutivoComercial.email))
        ? `Ejecutivo Comercial: ${ejecutivoComercial.nombre || ''}\n` +
          `Correo del ejecutivo: ${ejecutivoComercial.email || ''}\n`
        : '';

    firmaText =
      `\n--- CONSENTIMIENTO DECLARATIVO VERIFICADO${tipo} ---\n` +
      `Documento: ${c.numeroDocumento || ''}\n` +
      `Fecha: ${fecha}\n` +
      `Celular Verificado: ${c.celularValidado || ''}\n` +
      `Hash: ${consentData.hash?.substring(0, 16) || ''}...\n` +
      ejecutivoLineas +
      `---`;
  }

  // Build data map
  const data: Record<string, string> = {
    contrato: titular?.contrato || '',
    fecha: fmtDate(titular?._createdDate),
    primerNombre: titular?.primerNombre || '',
    segundoNombre: titular?.segundoNombre || '',
    primerApellido: titular?.primerApellido || '',
    segundoApellido: titular?.segundoApellido || '',
    numeroId: titular?.numeroId || '',
    fechaNacimiento: fmtDate(titular?.fechaNacimiento),
    domicilio: titular?.domicilio || '',
    ciudad: titular?.ciudad || '',
    celular: titular?.celular || '',
    email: titular?.email || '',
    ingresos: titular?.ingresos || '',
    empresa: titular?.empresa || '',
    cargo: titular?.cargo || '',
    observaciones: titular?.observacionesContrato || '',
    medioPago: financial?.medioPago || titular?.medioPago || '',
    beneficiarios: beneficiariosText,
    totalPlan: financial?.totalPlan != null ? String(financial.totalPlan) : '',
    pagoInscripcion: financial?.pagoInscripcion != null ? String(financial.pagoInscripcion) : '',
    saldo: financial?.saldo != null ? String(financial.saldo) : '',
    numeroCuotas: financial?.numeroCuotas != null ? String(financial.numeroCuotas) : '',
    valorCuota: financial?.valorCuota != null ? String(financial.valorCuota) : '',
    formaPago: financial?.formaPago || '',
    fechaPago: fmtDate(financial?.fechaPago),
    referenciaUno: titular?.referenciaUno || '',
    parentezcoRefUno: titular?.parentezcoRefUno || '',
    telefonoRefUno: titular?.telefonoRefUno || '',
    referenciaDos: titular?.referenciaDos || '',
    parentezcoRefDos: titular?.parentezcoRefDos || '',
    // Asesor: muestra el nombre resuelto (USUARIOS_ROLES) si está disponible,
    // si no el email crudo del titular. Plantillas Chile/Colombia usan {{asesor}}
    // al final del contrato (después del nombre del titular).
    asesor: ejecutivoComercial?.nombre || ejecutivoComercial?.email || titular?.asesor || '',
    telefonoRefDos: titular?.telefonoRefDos || '',
    firma: firmaText,
  };

  // Replace all {{key}} placeholders
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => data[key] ?? '');
}
