#!/usr/bin/env node

/**
 * Cron Worker para Digital Ocean App Platform
 *
 * Este script ejecuta tareas programadas usando node-cron.
 * Se despliega como un Worker separado en Digital Ocean.
 *
 * Tareas programadas:
 * - reconcile-pegados: Diariamente a las 9:00 PM Colombia (02:00 UTC)
 * - reactivate-onhold: Diariamente a las 10:00 PM Colombia (03:00 UTC)
 * - expire-contracts: Diariamente a las 11:00 PM Colombia (04:00 UTC)
 */

const cron = require('node-cron');

const NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'https://lgs-plataforma.com';
const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Obtiene timestamp en zona horaria local del sistema
 */
function getLocalTimestamp() {
  return new Date().toLocaleString();
}

if (!CRON_SECRET) {
  console.error('CRON_SECRET no esta configurado');
  process.exit(1);
}

console.log('Cron Worker iniciado');
console.log(`URL base: ${NEXTAUTH_URL}`);

/**
 * Ejecuta el cron de reconciliacion nocturna de usuarios pegados.
 * Solo toca casos limpios (sin overrides, sin clrHistoric). Los demas
 * quedan listados en el informe Hold & Vigencias para revision manual.
 */
async function executeReconcilePegados() {
  const timestamp = getLocalTimestamp();
  console.log(`\n[${timestamp}] Ejecutando reconcile-pegados...`);

  try {
    const response = await fetch(`${NEXTAUTH_URL}/api/cron/reconcile-pegados`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CRON_SECRET}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (response.ok && data.success) {
      console.log(`[${timestamp}] Completado: ${data.message}`);
      console.log(`   Procesados: ${data.processed}, Exitosos: ${data.successful}, Fallidos: ${data.failed}`);
    } else {
      console.error(`[${timestamp}] Error: ${data.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error(`[${timestamp}] Error de conexion:`, error.message);
  }
}

/**
 * Ejecuta el cron de activacion academica (MOSAICO).
 * Enciende ACADEMICA + login de beneficiarios aprobados 1 semana antes de inicioCurso.
 */
async function executeActivateAcademica() {
  const timestamp = getLocalTimestamp();
  console.log(`\n[${timestamp}] Ejecutando activate-academica...`);

  try {
    const response = await fetch(`${NEXTAUTH_URL}/api/cron/activate-academica`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CRON_SECRET}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (response.ok && data.success) {
      console.log(`[${timestamp}] Completado: ${data.message}`);
      console.log(`   Procesados: ${data.processed}, Exitosos: ${data.successful}, Fallidos: ${data.failed}`);
    } else {
      console.error(`[${timestamp}] Error: ${data.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error(`[${timestamp}] Error de conexion:`, error.message);
  }
}

/**
 * Ejecuta el cron de reactivacion de OnHold
 */
async function executeReactivateOnHold() {
  const timestamp = getLocalTimestamp();
  console.log(`\n[${timestamp}] Ejecutando reactivate-onhold...`);

  try {
    const response = await fetch(`${NEXTAUTH_URL}/api/cron/reactivate-onhold`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CRON_SECRET}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (response.ok && data.success) {
      console.log(`[${timestamp}] Completado: ${data.message}`);
      console.log(`   Procesados: ${data.processed}, Exitosos: ${data.successful}, Fallidos: ${data.failed}`);
    } else {
      console.error(`[${timestamp}] Error: ${data.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error(`[${timestamp}] Error de conexion:`, error.message);
  }
}

/**
 * Ejecuta el cron de expiracion de contratos
 */
async function executeExpireContracts() {
  const timestamp = getLocalTimestamp();
  console.log(`\n[${timestamp}] Ejecutando expire-contracts...`);

  try {
    const response = await fetch(`${NEXTAUTH_URL}/api/cron/expire-contracts`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CRON_SECRET}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (response.ok && data.success) {
      console.log(`[${timestamp}] Completado: ${data.message}`);
      console.log(`   Procesados: ${data.processed}, Exitosos: ${data.successful}, Fallidos: ${data.failed}`);
    } else {
      console.error(`[${timestamp}] Error: ${data.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error(`[${timestamp}] Error de conexion:`, error.message);
  }
}

// Programar tareas
// ================

// Activar academica (MOSAICO): Diariamente a las 01:30 UTC (8:30 PM Colombia)
cron.schedule('30 1 * * *', executeActivateAcademica, {
  scheduled: true,
  timezone: 'UTC'
});

// Reconciliar pegados (casos limpios): Diariamente a las 02:00 UTC (9:00 PM Colombia)
cron.schedule('0 2 * * *', executeReconcilePegados, {
  scheduled: true,
  timezone: 'UTC'
});

// Reactivar OnHold: Diariamente a las 03:00 UTC (10:00 PM Colombia)
cron.schedule('0 3 * * *', executeReactivateOnHold, {
  scheduled: true,
  timezone: 'UTC'
});

// Expirar contratos: Diariamente a las 04:00 UTC (11:00 PM Colombia)
cron.schedule('0 4 * * *', executeExpireContracts, {
  scheduled: true,
  timezone: 'UTC'
});

console.log('Tareas programadas:');
console.log('   - activate-academica: Diariamente a las 01:30 UTC (8:30 PM Colombia)');
console.log('   - reconcile-pegados: Diariamente a las 02:00 UTC (9:00 PM Colombia)');
console.log('   - reactivate-onhold: Diariamente a las 03:00 UTC (10:00 PM Colombia)');
console.log('   - expire-contracts: Diariamente a las 04:00 UTC (11:00 PM Colombia)');

// Ejecutar inmediatamente si se pasa el argumento --run-now
if (process.argv.includes('--run-now')) {
  console.log('\nEjecutando inmediatamente (--run-now)...');
  executeActivateAcademica();
  executeReconcilePegados();
  executeReactivateOnHold();
  executeExpireContracts();
}

// Ejecutar solo activate-academica si se pasa --activate-academica
if (process.argv.includes('--activate-academica')) {
  console.log('\nEjecutando activate-academica...');
  executeActivateAcademica();
}

// Ejecutar solo reconcile-pegados si se pasa --reconcile-pegados
if (process.argv.includes('--reconcile-pegados')) {
  console.log('\nEjecutando reconcile-pegados...');
  executeReconcilePegados();
}

// Ejecutar solo expire-contracts si se pasa --expire-contracts
if (process.argv.includes('--expire-contracts')) {
  console.log('\nEjecutando expire-contracts...');
  executeExpireContracts();
}

// Ejecutar solo reactivate-onhold si se pasa --reactivate-onhold
if (process.argv.includes('--reactivate-onhold')) {
  console.log('\nEjecutando reactivate-onhold...');
  executeReactivateOnHold();
}

// Mantener el proceso vivo
console.log('\nWorker en ejecucion. Presiona Ctrl+C para detener.\n');
