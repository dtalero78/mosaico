/**
 * Lanza los tests unitarios de reglas de negocio.
 *
 *   npm run test:unit            # todos
 *   npm run test:unit -- sesion  # sólo los que coincidan
 *
 * Existe como script de node y no como una línea en package.json porque hay que
 * pasarle a node la condición de exports `react-server`: sin ella, cualquier
 * módulo con `import 'server-only'` LANZA al importarse desde el runner, y varias
 * de las reglas que queremos cubrir viven en módulos server-only. Un
 * `VAR=x comando` en package.json no funcionaría en cmd de Windows (el mismo
 * problema que ya tiene el script `build`).
 *
 * Se invoca el CLI de Playwright con `node` y no con `npx`: en Windows con Node 24,
 * lanzar un `.cmd` sin shell devuelve EINVAL, y abrir un shell traería problemas de
 * comillas en las rutas con espacios.
 */
const { spawnSync } = require('child_process');

const cli = require.resolve('@playwright/test/cli');
const args = process.argv.slice(2);

const r = spawnSync(
  process.execPath,
  [cli, 'test', '--config=playwright.unit.config.ts', ...args],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --conditions=react-server`.trim(),
    },
  },
);
process.exit(r.status ?? 1);
