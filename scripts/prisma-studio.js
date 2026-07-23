#!/usr/bin/env node
/**
 * prisma-studio.js (MOSAICO) — abre Prisma Studio en el puerto FIJO 5555.
 *
 * ⚠ A DIFERENCIA del script de LGS: NO toca el firewall de la base de datos.
 *
 * mosaico-db está en modo "permitir todo" (sin trusted sources), así que Studio
 * conecta directo sin whitelistear ninguna IP. Agregar una regla de IP con
 * `doctl databases firewalls append` la pasaría de "permitir todo" a "SOLO esa IP"
 * y BLOQUEARÍA a la app de producción (mosaicosorobanplataforma.com) — pasó el
 * 2026-07-20: /dbmosaico se quedó sin tablas y el login se caía por timeout.
 *
 * Si algún día se decide RESTRINGIR mosaico-db, primero hay que agregar la app de
 * producción como trusted source (`doctl databases firewalls append <cluster>
 * --rule app:1609d16b-738f-4ff2-bef0-53011d34740b`) y sólo entonces re-agregar
 * aquí el whitelisting de IP para Studio.
 */
const { spawn } = require('child_process');
try { require('dotenv').config({ path: '.env.local' }); } catch {}
try { require('dotenv').config(); } catch {}

const PORT = '5555'; // MOSAICO fijo (LGS = 5556)

const url = process.env.DATABASE_URL;
if (!url) { console.error('❌ Falta DATABASE_URL en .env / .env.local'); process.exit(1); }

// Studio NUEVO (Prisma 7): interfaz con Visualizer / Console / SQL + Tables.
// Conecta DIRECTO a la BD por --url (introspección en vivo, no usa schema.prisma).
// Se invoca con npx prisma@7 para no tocar la dependencia del proyecto.
console.log(`🚀 Abriendo Prisma Studio MOSAICO (nuevo) en http://localhost:${PORT} (Ctrl+C para cerrar)…`);
const child = spawn('npx', ['-y', 'prisma@7', 'studio', '--port', PORT, '--url', `"${url}"`], { stdio: 'inherit', shell: true });

// Abrir el navegador (el studio nuevo no lo abre solo)
setTimeout(() => { try { spawn('cmd', ['/c', 'start', '', `http://localhost:${PORT}`], { shell: false }); } catch {} }, 12000);
child.on('exit', (code) => process.exit(code || 0));
