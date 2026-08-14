/**
 * Quién es el apoderado de un beneficiario y a qué teléfono se le escribe.
 *
 * Regla de negocio (agosto 2026): en **SENPAI** el alumno suele ser adulto y
 * firma su propio contrato, así que muchas fichas se crearon SIN apoderado. En
 * esos casos, cuando el TITULAR del contrato ES el propio beneficiario, el
 * apoderado por defecto es él mismo — es literalmente la misma persona, así que
 * no se está inventando un contacto.
 *
 * Los cursos de menores (YOJI/OKINA/KODOMO/DANSHI) NO entran aquí: ahí el
 * apoderado es un tercero y debe capturarse; que falte es un dato incompleto,
 * no algo que se pueda deducir.
 *
 * Funciones puras (sin `server-only`): las usan endpoints, servicios y scripts.
 */

/** ¿En este curso el apoderado puede deducirse del titular cuando falta? */
export function apoderadoPorDefectoEsTitular(tipoCurso?: string | null): boolean {
  return String(tipoCurso || '').trim().toUpperCase() === 'SENPAI';
}

export interface PersonaMinima {
  numeroId?: string | null;
  primerNombre?: string | null;
  segundoNombre?: string | null;
  primerApellido?: string | null;
  segundoApellido?: string | null;
  celular?: string | null;
  email?: string | null;
}

export const nombreCompletoPersona = (p?: PersonaMinima | null): string =>
  [p?.primerNombre, p?.segundoNombre, p?.primerApellido, p?.segundoApellido]
    .map(s => String(s || '').trim()).filter(Boolean).join(' ').trim();

const mismoDocumento = (a?: string | null, b?: string | null) => {
  const n = (s?: string | null) => String(s || '').trim().toUpperCase();
  return !!n(a) && n(a) === n(b);
};

export interface ApoderadoResuelto {
  nombre: string;
  telefono: string;
  email: string;
  /** De dónde salió: la ficha del alumno, el titular (que es él mismo) o el propio alumno. */
  origen: 'ficha' | 'titular' | 'alumno' | 'ninguno';
}

/**
 * Resuelve el apoderado efectivo de un beneficiario para contactarlo.
 * Orden: apoderado de su ficha → titular del contrato (sólo si el curso lo
 * permite y el titular ES el beneficiario) → el propio alumno.
 */
export function resolverApoderado(
  benef: PersonaMinima & { tipoCurso?: string | null; apoderado?: string | null; apoderadoTelefono?: string | null; apoderadoMail?: string | null },
  titular?: PersonaMinima | null
): ApoderadoResuelto {
  const tel = String(benef?.apoderadoTelefono || '').trim();
  if (tel) {
    return {
      nombre: String(benef?.apoderado || '').trim() || nombreCompletoPersona(benef),
      telefono: tel,
      email: String(benef?.apoderadoMail || '').trim(),
      origen: 'ficha',
    };
  }

  if (
    apoderadoPorDefectoEsTitular(benef?.tipoCurso) &&
    titular &&
    mismoDocumento(titular.numeroId, benef?.numeroId) &&
    String(titular.celular || '').trim()
  ) {
    return {
      nombre: nombreCompletoPersona(titular),
      telefono: String(titular.celular).trim(),
      email: String(titular.email || '').trim(),
      origen: 'titular',
    };
  }

  const propio = String(benef?.celular || '').trim();
  if (propio) {
    return { nombre: nombreCompletoPersona(benef), telefono: propio, email: String(benef?.email || '').trim(), origen: 'alumno' };
  }
  return { nombre: '', telefono: '', email: '', origen: 'ninguno' };
}
