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
 * Un monto de FINANCIEROS a número.
 *
 * Los importes se guardan como TEXTO (VARCHAR heredado de Wix). Hoy las 686
 * filas son dígitos puros, pero se limpia cualquier signo por si alguna llegara
 * editada a mano: en los montos de la plataforma el punto es separador de
 * MILES y no decimal —la misma suposición que hace `parseCurrency` del
 * frontend—, así que se descarta con el resto.
 */
function montoANumero(value: any): number {
  if (value == null || value === '') return NaN;
  const n = parseInt(String(value).replace(/[^\d-]/g, ''), 10);
  return isNaN(n) ? NaN : n;
}

/**
 * El saldo que imprime el CONTRATO es el de la FIRMA, no el vivo.
 *
 * ⚠ `FINANCIEROS.saldo` lo REESCRIBE `syncFinancieroSaldo` cada vez que se
 * valida un pago: es el "Saldo a la Fecha" que muestra la pestaña Financiera de
 * /person y baja mes a mes. El contrato es el documento que el cliente firmó y
 * tiene que decir lo que se pactó — leer esa columna hacía que regenerar el PDF
 * en el mes 6 produjera un texto distinto del que se aceptó, y el
 * `hashConsentimiento` no lo detecta porque se calcula sobre el consentimiento,
 * no sobre el bloque financiero.
 *
 * Se DERIVA de `totalPlan − pagoInscripcion`: las dos son inmutables (el sync
 * no las toca) y es la misma resta con la que el wizard lo calcula, donde el
 * campo Saldo es de sólo lectura y nunca se teclea — así que la fórmula
 * reproduce exactamente lo firmado, también en los contratos ya creados.
 *
 * Si faltara el total se cae al valor guardado, antes que imprimir un vacío.
 */
function saldoALaFirma(financial: any): string {
  const total = montoANumero(financial?.totalPlan);
  if (isNaN(total)) return financial?.saldo != null ? String(financial.saldo) : '';
  const inscripcion = montoANumero(financial?.pagoInscripcion);
  return String(Math.max(0, total - (isNaN(inscripcion) ? 0 : inscripcion)));
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
        `- Email: ${b.email || ''}\n` +
        `- Campaña: ${b.campaign || ''}\n` +
        `- Curso: ${b.tipoCurso || ''}\n` +
        `- Salon: ${b.salon || ''}\n` +
        `- Horario: ${b.horarioCurso || ''}\n` +
        `- Apoderado: ${b.apoderado || ''}\n` +
        `- Telefono Apoderado: ${b.apoderadoTelefono || ''}\n` +
        `- Correo Apoderado: ${b.apoderadoMail || ''}`
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

  // Correo del asesor: sólo se acepta algo que REALMENTE sea un correo.
  // `PEOPLE.asesor` guarda el nombre del comercial en la mayoría de los
  // contratos, así que nunca puede usarse como correo.
  const looksLikeEmail = (v: any) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  const asesorMailValue = looksLikeEmail(titular?.asesorMail)
    ? String(titular.asesorMail).trim()
    : (looksLikeEmail(ejecutivoComercial?.email) ? String(ejecutivoComercial!.email).trim() : '');

  // Campaña del contrato: el TITULAR no la tiene (campaign=null) — sale de los
  // beneficiarios (comparten la misma campaña). Fallback a la del titular por si acaso.
  const campanaValue =
    (Array.isArray(beneficiarios) ? (beneficiarios.find((b: any) => b?.campaign)?.campaign) : '') ||
    titular?.campaign || '';

  // Build data map
  const data: Record<string, string> = {
    contrato: titular?.contrato || '',
    campana: campanaValue,
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
    telefonoCasa: titular?.telefono || '',
    email: titular?.email || '',
    ingresos: titular?.ingresos || '',
    empresa: titular?.empresa || '',
    cargo: titular?.cargo || '',
    // MOSAICO — apoderado, vigencia y valor pagado (presentes en el contrato Chile)
    nombreApoderado: titular?.apoderado || '',
    telefonoApoderado: titular?.apoderadoTelefono || '',
    vigenciaMeses: financial?.vigencia != null ? String(financial.vigencia) : (titular?.vigencia != null ? String(titular.vigencia) : ''),
    valorPagado: financial?.pagoInscripcion != null ? String(financial.pagoInscripcion) : '',
    observaciones: titular?.observacionesContrato || '',
    medioPago: financial?.medioPago || titular?.medioPago || '',
    beneficiarios: beneficiariosText,
    totalPlan: financial?.totalPlan != null ? String(financial.totalPlan) : '',
    pagoInscripcion: financial?.pagoInscripcion != null ? String(financial.pagoInscripcion) : '',
    // NO es `financial.saldo` — ver saldoALaFirma: esa columna es el saldo VIVO.
    saldo: saldoALaFirma(financial),
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
    // Correo del asesor comercial. La plantilla Chile usa {{asesorMail}} (camelCase);
    // se registran AMBAS grafías por compatibilidad. Prefiere PEOPLE.asesorMail y,
    // si no, el email resuelto del ejecutivo.
    // OJO: NO cae a `titular.asesor` — esa columna guarda el NOMBRE del comercial
    // en la mayoría de los contratos, y ese fallback era el que hacía imprimir
    // "Correo del ejecutivo: Antonella Calderón". Sin correo, va vacío.
    asesorMail: asesorMailValue,
    asesormail: asesorMailValue,
    telefonoRefDos: titular?.telefonoRefDos || '',
    firma: firmaText,
  };

  // Replace all {{key}} placeholders
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => data[key] ?? '');
}
