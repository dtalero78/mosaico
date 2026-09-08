/**
 * Badge "Contrato de prueba" — alerta visual cuando un registro pertenece
 * a un contrato con prefijo PRB- (creado vía wizard con el checkbox marcado).
 *
 * Aparece en headers de /person/[id] y /student/[id]. Naranja prominente,
 * para que el admin sepa que está mirando datos de prueba y no los confunda
 * con reales. Estos contratos NO aparecen en informes y pueden purgarse
 * en Mantenimiento > Usuarios > Contratos Prueba.
 */
// La regla (y la marca de agua) viven en el lib, que tambien usan el PDF y la
// pagina publica. Se re-exporta aqui para no romper los imports existentes.
import { isContratoPrueba } from '@/lib/contrato-prueba';
export { isContratoPrueba };

export function ContratoPruebaBadge({ contrato }: { contrato?: string | null }) {
  if (!isContratoPrueba(contrato)) return null;
  return (
    <span
      className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-orange-100 text-orange-800 border border-orange-400 text-xs font-bold uppercase tracking-wide shadow-sm"
      title={`Contrato ${contrato} — registro de PRUEBA. NO aparece en informes. Puede ser purgado desde Mantenimiento > Usuarios > Contratos Prueba.`}
    >
      🧪 Contrato de prueba
    </span>
  );
}

export default ContratoPruebaBadge;
