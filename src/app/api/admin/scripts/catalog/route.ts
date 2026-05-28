/**
 * API Route: GET /api/admin/scripts/catalog
 *
 * Escanea el directorio scripts/ del repositorio y devuelve, por cada .js,
 * su metadata derivada del código: utilidad (comentario de cabecera), comando
 * de ejecución, si requiere parámetros y el tipo (lectura/escritura).
 *
 * Gateado por MANTENIMIENTO.SCRIPTS.CONSULTA (SUPER_ADMIN/ADMIN bypass).
 * Solo lectura del filesystem — nunca ejecuta los scripts.
 */

import fs from 'fs';
import path from 'path';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';

export const dynamic = 'force-dynamic';

interface ScriptInfo {
  name: string;
  utilidad: string;
  ejecucion: string;
  requiereParametros: boolean;
  parametros: string;
  tipo: 'Solo lectura' | 'Escribe' | 'Escribe (--apply)';
}

function parseScript(name: string, src: string): ScriptInfo {
  // ── Comentario de cabecera (primer bloque /** ... */) ──
  const block = src.match(/\/\*\*([\s\S]*?)\*\//);
  let utilidad = '';
  let usoLine = '';
  if (block) {
    const lines = block[1]
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      .filter((l) => l.length > 0);
    const usoIdx = lines.findIndex((l) => /^uso\b/i.test(l));
    const descLines = usoIdx >= 0 ? lines.slice(0, usoIdx) : lines;
    utilidad = descLines.join(' ').replace(/\s+/g, ' ').trim();
    if (usoIdx >= 0) {
      usoLine = lines
        .slice(usoIdx)
        .join(' ')
        .replace(/^uso[:\s]*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }
  if (!utilidad) utilidad = '(sin descripción en el encabezado del script)';

  // ── Parámetros ──
  const flags = [
    ...new Set(
      [...src.matchAll(/process\.argv\.includes\(\s*['"](--[\w-]+)['"]/g)].map((m) => m[1])
    ),
  ];
  const usesPositional = /process\.argv\[2\]|process\.argv\.slice\(\s*2\s*\)/.test(src);
  const requiereParametros = flags.length > 0 || usesPositional;

  const parametrosParts: string[] = [];
  if (flags.length) parametrosParts.push(flags.join(' '));
  if (usesPositional) parametrosParts.push('<argumento posicional>');
  const parametros = parametrosParts.length ? parametrosParts.join(' ') : '—';

  // ── Comando de ejecución ──
  let ejecucion = usoLine;
  if (!ejecucion) {
    ejecucion = `node scripts/${name}`;
    if (flags.length) ejecucion += ' ' + flags.map((f) => `[${f}]`).join(' ');
  }

  // ── Tipo (heurística de lectura/escritura) ──
  // El flag --apply es la convención del repo para "modo escritura" (dry-run por
  // defecto), así que manda incluso si el SQL se arma dinámicamente y el regex
  // de abajo no lo detecta.
  const hasWrite = /\b(UPDATE\s|INSERT\s+INTO|DELETE\s+FROM|ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE)\b/i.test(src);
  let tipo: ScriptInfo['tipo'];
  if (flags.includes('--apply')) tipo = 'Escribe (--apply)';
  else if (hasWrite) tipo = 'Escribe';
  else tipo = 'Solo lectura';

  return { name, utilidad, ejecucion, requiereParametros, parametros, tipo };
}

export const GET = handlerWithAuth(async (_req, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.SCRIPTS_CONSULTA);

  const dir = path.join(process.cwd(), 'scripts');
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  } catch {
    files = [];
  }

  const scripts: ScriptInfo[] = files
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      try {
        const src = fs.readFileSync(path.join(dir, name), 'utf8');
        return parseScript(name, src);
      } catch {
        return {
          name,
          utilidad: '(no se pudo leer el archivo)',
          ejecucion: `node scripts/${name}`,
          requiereParametros: false,
          parametros: '—',
          tipo: 'Solo lectura' as const,
        };
      }
    });

  return successResponse({
    scripts,
    total: scripts.length,
    generatedAt: new Date().toISOString(),
  });
});
