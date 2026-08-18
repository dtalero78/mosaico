import { defineConfig } from '@playwright/test';

/**
 * Tests unitarios de las reglas de negocio.
 *
 * Config aparte de `playwright.config.ts` (que es la de E2E) porque estos NO
 * necesitan navegador, ni servidor levantado, ni base de datos: son funciones
 * puras. Corren en segundos y se pueden ejecutar en cualquier momento, que es
 * justo lo que hace falta para poder mover una regla sin miedo.
 *
 *   npm run test:unit
 */
export default defineConfig({
  testDir: './tests/unit',
  timeout: 10 * 1000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
});
