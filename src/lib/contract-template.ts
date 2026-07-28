/**
 * Resuelve qué plantilla de contrato (fila de ContractTemplates.plataforma) usar
 * para un titular.
 *
 * Regla: los contratos de IMPULSA usan una plantilla propia (método IMPULSA PAES),
 * distinta de la de Soroban por país. Se detectan por `PEOPLE.esCursoImpulsa=true`
 * del titular. Si no es Impulsa → su plataforma (Chile / Colombia / …).
 *
 * Cliente + servidor (sin 'server-only'): lo usan tanto los endpoints de PDF como
 * la vista "Ver Contrato".
 */
export function templatePlataformaFor(titular: any): string {
  if (titular?.esCursoImpulsa === true) return 'IMPULSA';
  return String(titular?.plataforma || '').trim();
}
