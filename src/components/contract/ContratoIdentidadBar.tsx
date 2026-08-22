'use client'

/**
 * Barra de identidad del contrato en curso — N.º de contrato + titular.
 *
 * Los wizards de contrato son de siete u ocho pasos: para cuando el comercial
 * llega a Referencias o al Financiero ya no tiene a la vista para quién está
 * llenando el formulario, y el N.º de contrato quedó en el paso 2. Esta barra
 * queda pegada arriba y lo acompaña por todos los pasos.
 *
 * Es sólo lectura: el número y el nombre se capturan en su paso, aquí se
 * recuerdan.
 */

interface Props {
  /** N.º de contrato. Vacío mientras no se haya generado o escrito. */
  contrato?: string | null
  /** Nombres del titular, en el orden en que se capturan. */
  primerNombre?: string | null
  segundoNombre?: string | null
  primerApellido?: string | null
  segundoApellido?: string | null
  /** Documento del titular, si ya se capturó. */
  numeroId?: string | null
  /** Contrato de prueba (prefijo PRB-) — se pinta en naranja. */
  esPrueba?: boolean
  /** Matrícula fuera de plazo. */
  esExtemporanea?: boolean
}

export default function ContratoIdentidadBar({
  contrato, primerNombre, segundoNombre, primerApellido, segundoApellido,
  numeroId, esPrueba, esExtemporanea,
}: Props) {
  const nombre = [primerNombre, segundoNombre, primerApellido, segundoApellido]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' ')

  // Sin número ni nombre no hay nada que recordar todavía (paso 1).
  if (!contrato && !nombre) return null

  const tono = esPrueba
    ? 'bg-orange-50 border-orange-200'
    : 'bg-primary-50 border-primary-200'

  return (
    <div className={`sticky top-0 z-20 -mx-6 px-6 py-3 mb-4 border-b ${tono} backdrop-blur`}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span>
          <span className="text-gray-500">Contrato: </span>
          <strong className="font-semibold text-gray-900 tabular-nums">
            {contrato || <span className="font-normal text-gray-400">por asignar</span>}
          </strong>
        </span>
        <span>
          <span className="text-gray-500">Titular: </span>
          <strong className="font-semibold text-gray-900">
            {nombre || <span className="font-normal text-gray-400">sin capturar</span>}
          </strong>
        </span>
        {numeroId && (
          <span className="text-gray-500">
            ID: <span className="text-gray-900 tabular-nums">{numeroId}</span>
          </span>
        )}
        {esPrueba && (
          <span className="text-orange-800 font-semibold">🧪 prueba</span>
        )}
        {esExtemporanea && (
          <span className="text-red-700 font-semibold">⏰ extemporánea</span>
        )}
      </div>
    </div>
  )
}
