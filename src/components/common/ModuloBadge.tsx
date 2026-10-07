/**
 * Distintivo Sí/No de un contrato "Módulo" (PEOPLE.modulo del titular: vigencia
 * fija de 3 meses). Lo usan Gestión de Aprobaciones (Pendientes y Migración) y
 * Comercial › Vencimientos, para que las tres pantallas lo pinten igual.
 */
export default function ModuloBadge({ modulo }: { modulo?: boolean | null }) {
  const si = modulo === true
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        si ? 'bg-primary-100 text-primary-800' : 'bg-gray-100 text-gray-600'
      }`}
      title={si ? 'Contrato Módulo: vigencia fija de 3 meses' : 'No es un contrato Módulo'}
    >
      {si ? 'Sí' : 'No'}
    </span>
  )
}
