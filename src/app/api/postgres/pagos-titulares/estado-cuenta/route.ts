import 'server-only';
import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { handlerWithAuth } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { PersonPermission } from '@/types/permissions';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { queryOne, queryMany } from '@/lib/postgres';
import { buildEstadoCuentaPdf, type EstadoCuentaData, type EstadoCuentaMov } from '@/lib/estado-cuenta-pdf';
import { computePlataformaScope, getSessionPlataforma } from '@/lib/recaudos-scope';
import { asignarPagos, ordenarPagos } from '@/lib/cuotas-pagos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/postgres/pagos-titulares/estado-cuenta?idPeople=&modo=mes|total&mes=YYYY-MM
 *
 * Genera el "Estado de Cuenta" del titular en PDF (protegido con contraseña =
 * número de documento del titular) con el logo y la paleta de MOSAICO. Gate:
 * PERSON.FINANCIERA.ESTADO_CUENTA (SUPER_ADMIN/ADMIN bypass) + alcance por
 * plataforma de Recaudos. El calendario de cuotas se calcula desde
 * FINANCIEROS.fechaPago (corte mensual) y se cruza con los pagos REGISTRADOS
 * en PAGOS_TITULARES (validados o no).
 */

// Parseo de importes. OJO: las columnas `numeric` de PAGOS_TITULARES
// (valorPagado, descuento, saldo) las devuelve pg como STRING con decimales
// ("214500.00"). Hay que respetar el punto decimal — NO quitarlo (eso convertía
// "214500.00" en 21.450.000). Los importes de FINANCIEROS son enteros planos
// como texto ("1540000"), sin separadores de miles, así que parseFloat sirve
// para ambos. (Un eventual símbolo/espacio se limpia antes de parsear.)
const num = (v: any): number => {
  if (v == null) return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).replace(/[^\d.,-]/g, '');
  // Varios puntos = separadores de miles ("1.540.000") → quitarlos.
  if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  s = s.replace(',', '.');            // coma decimal → punto
  const f = parseFloat(s);
  return isFinite(f) ? Math.round(f) : 0;
};

const fmtMoney = (n: number) => '$' + new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Math.round(n || 0));

const norm = (s: any): string =>
  String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const isValidDate = (d: Date) => !isNaN(d.getTime());

function addMonthsUTC(d: Date, n: number): Date {
  const day = d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, lastDay));
  return t;
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const monthLabel = (d: Date) => `${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

/** Cuenta de quien firma el Estado de Cuenta (Jefe de Recaudos). */
const FIRMANTE_EMAIL = 'mpalaciosq@mosaicosoroban.cl';

export const GET = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, PersonPermission.ESTADO_CUENTA);

  const { searchParams } = new URL(req.url);
  const idPeople = searchParams.get('idPeople');
  if (!idPeople) throw new ValidationError('idPeople requerido');
  const modo: 'mes' | 'total' = searchParams.get('modo') === 'mes' ? 'mes' : 'total';
  const mesParam = (searchParams.get('mes') || '').trim(); // 'YYYY-MM'

  // 1. Titular
  const titular = await queryOne<any>(`SELECT * FROM "PEOPLE" WHERE "_id" = $1`, [idPeople]);
  if (!titular) throw new NotFoundError('Titular', idPeople);
  if (titular.tipoUsuario !== 'TITULAR') throw new ValidationError('El Estado de Cuenta sólo aplica a titulares');

  // Alcance por plataforma (un jefe de Chile no genera estados de cuenta de otros países).
  const u = (session as any)?.user;
  const scope = computePlataformaScope(String(u?.role ?? ''), await getSessionPlataforma(u?.email ?? null));
  if (scope.filter) {
    const pl = String(titular.plataforma ?? '').trim().toLowerCase();
    const dentro = scope.filter.type === 'include' ? scope.filter.values.includes(pl) : !scope.filter.values.includes(pl);
    if (!dentro) throw new ValidationError('El contrato no pertenece a su plataforma');
  }

  // 2. Financiero
  const fin = titular.contrato
    ? await queryOne<any>(
        `SELECT * FROM "FINANCIEROS" WHERE "contrato" = $1 ORDER BY "_createdDate" DESC LIMIT 1`,
        [titular.contrato],
      )
    : null;

  // 3. Beneficiarios (estudiantes)
  const bens = titular.contrato
    ? await queryMany<any>(
        `SELECT "primerNombre","segundoNombre","primerApellido","segundoApellido","numeroId","celular","telefono","tipoCurso","campaign"
         FROM "PEOPLE" WHERE "contrato" = $1 AND "tipoUsuario" = 'BENEFICIARIO' ORDER BY "primerNombre" ASC`,
        [titular.contrato],
      )
    : [];

  // 4. Pagos REGISTRADOS (validados o no)
  const todosLosPagos = await queryMany<any>(
    `SELECT "_id","numCuota","fechaPago","_createdDate","valorPagado","descuento","medioPago","banco","numeroReferencia","validado","inscripcion","penalidadPlanId"
     FROM "PAGOS_TITULARES" WHERE "idPeople" = $1`,
    [idPeople],
  );

  // Los pagos de un arreglo de penalidad (Pago Especial) NO son pagos del plan: no cubren
  // cuotas ni bajan el saldo del plan; se muestran aparte como «Pago arreglo penalidad».
  const pagos = todosLosPagos.filter(p => !p.penalidadPlanId);
  const pagosPenalidad = todosLosPagos.filter(p => !!p.penalidadPlanId);

  // 5. Quien firma el Estado de Cuenta: María Palacios (Jefe de Recaudos), con su
  //    firma manuscrita (public/firmas/maria-palacios.png). Es la misma para todas
  //    las plataformas: así lo definió Recaudos. El nombre y el correo salen de su
  //    cuenta; si no se encuentra, se usa el nombre fijo.
  const pais = norm(titular.plataforma);
  const esChile = pais === 'chile';
  const firmante = await queryOne<any>(
    `SELECT TRIM(CONCAT_WS(' ', "nombre", "apellido")) AS nombre, "email" FROM "USUARIOS_ROLES"
      WHERE LOWER("email") = $1 AND "activo" IS TRUE LIMIT 1`,
    [FIRMANTE_EMAIL],
  );
  const cartera = {
    nombre: firmante?.nombre || 'María Palacios',
    cargo: 'Jefe de Recaudos',
    email: firmante?.email || FIRMANTE_EMAIL,
  };

  // ── Datos del plan ──────────────────────────────────────────────────────
  const valorCuota = num(fin?.valorCuota);
  const numeroCuotas = parseInt(fin?.numeroCuotas, 10) || 0;
  const inscripcion = num(fin?.pagoInscripcion);
  const totalPlan = num(fin?.totalPlan) || (inscripcion + numeroCuotas * valorCuota);
  const baseISO: string = fin?.fechaPago || titular.inicioContrato || titular.fechaContrato || new Date().toISOString();
  const base = new Date(baseISO);
  const diaPago = isValidDate(base) ? base.getUTCDate() : null;
  const matricula: string | null = titular.inicioContrato || titular.fechaContrato || (fin?.fechaPago ?? null);

  const canalDe = (p: any) => [p?.medioPago, p?.banco].filter(Boolean).join(' · ') || '—';

  const todayUTC = new Date();
  const hoy0 = Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), todayUTC.getUTCDate());

  // ── Totales de PAGOS (efectivo + descuento) ─────────────────────────────
  // Un pago único con descuento puede liquidar VARIAS cuotas (cambio a contado).
  // La deuda se cubre con lo abonado en efectivo MÁS el descuento aplicado.
  const abonado = pagos.reduce((s, p) => s + num(p.valorPagado), 0);
  const descontado = pagos.reduce((s, p) => s + num(p.descuento), 0);
  const cubiertoTotal = abonado + descontado;

  // ── Cronograma (inscripción + cuotas) y ASIGNACIÓN EN CASCADA ───────────
  // La cobertura de cada pago (valorPagado + descuento) se reparte, en orden
  // cronológico, sobre inscripción → cuota 1 → cuota 2 … hasta agotarse. Así
  // un abono grande marca como pagadas todas las cuotas que alcanza a cubrir.
  type Item = { n: string; concepto: string; vence: string | null; valor: number };
  const items: Item[] = [{ n: 'CI', concepto: 'Inscripción', vence: matricula, valor: inscripcion }];
  for (let k = 1; k <= numeroCuotas; k++) {
    const venceD = isValidDate(base) ? addMonthsUTC(base, k - 1) : null;
    items.push({
      n: String(k),
      concepto: `Cuota ${k}${venceD ? ' · ' + monthLabel(venceD) : ''}`,
      vence: venceD ? venceD.toISOString() : null,
      valor: valorCuota,
    });
  }

  // Asignación (regla única en src/lib/cuotas-pagos.ts): cada pago EMPIEZA a
  // cubrir en SU cuota y DESBORDA hacia adelante; nunca rellena hacia atrás.
  // El descuento completa la cuota igual que el efectivo.
  const asig = asignarPagos({ inscripcion, valorCuota, numeroCuotas, pagos });
  const pagoPorId = new Map(pagos.map(p => [p._id, p]));
  const pagosOrden = ordenarPagos(pagos);

  const todos: EstadoCuentaMov[] = items.map((it, i) => {
    const c = asig.cuotas[i];
    const completo = c ? c.completa : false;
    const parcial = !completo && (c?.cubierto ?? 0) > 0.5;
    // Fecha/canal = el último pago que tocó la cuota (el que la completó o el último abono).
    const ultimo = c?.aportes.length ? c.aportes[c.aportes.length - 1] : null;
    const p = ultimo ? pagoPorId.get(ultimo.pagoId) : null;
    let estado: EstadoCuentaMov['estado'];
    if (completo) estado = 'Pagado';
    else if (parcial) estado = 'Parcial';
    else {
      const v = it.vence ? new Date(it.vence) : null;
      if (v && isValidDate(v)) {
        const v0 = Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
        estado = v0 < hoy0 ? 'En mora' : 'Por vencer';
      } else estado = 'Pendiente';
    }
    // Etiqueta + detalle de abonos (solo si hubo más de un pago o quedó parcial).
    let etiqueta: string | null = c?.etiqueta ?? null;
    if (etiqueta === 'Abono parcial') etiqueta = `Abono parcial — pagado ${fmtMoney(c!.cubierto)}, faltan ${fmtMoney(c!.falta)}`;
    const detalle = c && (c.aportes.length >= 2 || parcial)
      ? c.aportes.map(a => ({ fecha: a.fechaPago ? new Date(a.fechaPago as any).toISOString() : null, monto: a.monto, descuento: a.descuento }))
      : [];
    return {
      n: it.n, concepto: it.concepto, vence: it.vence,
      pago: p?.fechaPago || null,
      valor: it.valor,
      canal: p ? canalDe(p) : '—',
      estado,
      etiqueta,
      detalle,
    };
  });

  // Fila adicional de DESCUENTO (solo si hay) para evidenciar descuento + pago total.
  if (descontado > 0) {
    const ultConDesc = pagosOrden.filter(p => num(p.descuento) > 0).slice(-1)[0];
    todos.push({
      n: 'DESC', concepto: 'Descuento aplicado', vence: null,
      pago: ultConDesc?.fechaPago || null,
      valor: -descontado,
      canal: '—', estado: 'Descuento',
    });
  }

  // Pagos del arreglo de penalidad: una fila por pago, fuera de las cuotas y de los conteos.
  pagosPenalidad
    .sort((a, b) => String(a.fechaPago || '').localeCompare(String(b.fechaPago || '')))
    .forEach((p, i) => {
      todos.push({
        n: 'PEN', concepto: `Pago arreglo penalidad${pagosPenalidad.length > 1 ? ' ' + (i + 1) : ''}`, vence: null,
        pago: p.fechaPago || null, valor: num(p.valorPagado), canal: canalDe(p), estado: 'Arreglo penalidad',
      });
    });

  // ── Resumen: efectivo + descuento cubren la deuda ───────────────────────
  const pagado = Math.min(totalPlan, abonado);
  const descuento = Math.min(totalPlan, descontado);
  const saldo = Math.max(0, totalPlan - abonado - descontado);
  const avancePct = totalPlan > 0 ? Math.min(100, (cubiertoTotal / totalPlan) * 100) : 0;

  const insMov = todos.find(m => m.n === 'CI');
  const cuotaMovs = todos.filter(m => m.n !== 'CI' && m.n !== 'DESC' && m.n !== 'PEN');
  const mora = cuotaMovs.filter(m => m.estado === 'En mora').reduce((s, m) => s + m.valor, 0);
  const porVencer = cuotaMovs.filter(m => m.estado === 'Por vencer').reduce((s, m) => s + m.valor, 0);

  const segEstado = (m: EstadoCuentaMov): 'pagada' | 'parcial' | 'mora' | 'porvencer' =>
    m.estado === 'Pagado' ? 'pagada' :
    m.estado === 'Parcial' ? 'parcial' :
    m.estado === 'En mora' ? 'mora' : 'porvencer';
  const segmentos: Array<'insPagada' | 'insPend' | 'pagada' | 'parcial' | 'mora' | 'porvencer'> = [
    insMov && insMov.estado === 'Pagado' ? 'insPagada' : insMov && insMov.estado === 'Parcial' ? 'parcial' : 'insPend',
    ...cuotaMovs.map(segEstado),
  ];
  const cuotasPagadasCnt = cuotaMovs.filter(m => m.estado === 'Pagado').length;
  const parcialCnt = cuotaMovs.filter(m => m.estado === 'Parcial').length;
  const enMoraCnt = cuotaMovs.filter(m => m.estado === 'En mora').length;
  const porVencerCnt = cuotaMovs.filter(m => m.estado === 'Por vencer' || m.estado === 'Pendiente').length;

  // ── Filtrado por modo ───────────────────────────────────────────────────
  let movimientos = todos;
  let mesLabel = 'Consolidado total';
  let proximoPago: EstadoCuentaMov | null = null;
  let ultimoPago: EstadoCuentaMov | null = null;

  if (modo === 'mes') {
    // Mes seleccionado (default: mes actual)
    let anio = todayUTC.getUTCFullYear();
    let mes = todayUTC.getUTCMonth();
    if (/^\d{4}-\d{2}$/.test(mesParam)) {
      anio = parseInt(mesParam.slice(0, 4), 10);
      mes = parseInt(mesParam.slice(5, 7), 10) - 1;
    }
    mesLabel = `${MESES[mes]} ${anio}`;
    movimientos = todos.filter(m => {
      if (!m.vence) return false;
      const v = new Date(m.vence);
      return isValidDate(v) && v.getUTCFullYear() === anio && v.getUTCMonth() === mes;
    });
    // Próximo pago = primera cuota no pagada por fecha de vencimiento
    proximoPago = [...todos]
      .filter(m => m.n !== 'DESC' && m.n !== 'PEN' && m.estado !== 'Pagado' && m.vence)
      .sort((a, b) => new Date(a.vence!).getTime() - new Date(b.vence!).getTime())[0] || null;
    // Último pago = movimiento pagado con la fecha de pago más reciente
    ultimoPago = [...todos]
      .filter(m => m.n !== 'DESC' && m.n !== 'PEN' && m.pago)
      .sort((a, b) => new Date(b.pago!).getTime() - new Date(a.pago!).getTime())[0] || null;
  }

  // ── Empresa / logo MOSAICO ──────────────────────────────────────────────
  const empresa = esChile
    ? { razon: 'MOSAICO CHILE SPA', nit: '' }
    : { razon: 'MOSAICO', nit: '' };

  // Logo pequeño (el mismo del membrete del contrato): se embebe en cada PDF.
  let logoPath: string | null = null;
  try {
    const p = path.join(process.cwd(), 'public', 'logo-contrato.png');
    if (fs.existsSync(p)) logoPath = p;
  } catch { logoPath = null; }

  // Firma manuscrita de María Palacios (si falta el archivo, el PDF sale sin imagen).
  let firmaPath: string | null = null;
  try {
    const fp = path.join(process.cwd(), 'public', 'firmas', 'maria-palacios.png');
    if (fs.existsSync(fp)) firmaPath = fp;
  } catch { firmaPath = null; }

  const nombreTitular = [titular.primerNombre, titular.segundoNombre, titular.primerApellido, titular.segundoApellido].filter(Boolean).join(' ');

  const data: EstadoCuentaData = {
    modo,
    mesLabel,
    empresa,
    logoPath,
    firmaPath,
    contrato: titular.contrato || '—',
    corte: new Date().toISOString(),
    diaPago,
    plan: {
      nombre: (titular.plan || fin?.plan || 'Plan').toString(),
      cuotas: numeroCuotas,
      valorCuota,
      valorTotal: totalPlan,
      inscripcion,
    },
    titular: {
      nombre: nombreTitular || '—',
      documento: titular.numeroId || '—',
      cel: titular.celular || titular.telefono || '—',
      email: titular.email || '—',
    },
    estudiantes: bens.map(b => ({
      nombre: [b.primerNombre, b.segundoNombre, b.primerApellido, b.segundoApellido].filter(Boolean).join(' '),
      documento: b.numeroId || '',
      cel: b.celular || b.telefono || '',
      programa: [b.tipoCurso, b.campaign].filter(Boolean).join(' · '),
    })),
    cartera,
    resumen: { pagado, mora, porVencer, saldo, avancePct },
    progreso: {
      valorPlan: totalPlan,
      pagado,
      descuento,
      saldo,
      progresoPct: avancePct,
      cuotasPagadas: cuotasPagadasCnt,
      parcial: parcialCnt,
      enMora: enMoraCnt,
      porVencer: porVencerCnt,
      segmentos,
    },
    movimientos,
    proximoPago,
    ultimoPago,
    password: (titular.numeroId || titular.contrato || 'MOSAICO').toString(),
  };

  const pdf = await buildEstadoCuentaPdf(data);
  const fname = `estado-cuenta-${(titular.contrato || idPeople)}${modo === 'mes' && mesParam ? '-' + mesParam : ''}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${fname}"`,
      'Cache-Control': 'no-store',
    },
  });
});
