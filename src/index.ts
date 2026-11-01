
import { launch } from 'puppeteer';

import { login } from './services/auth';
import {
  goToReservations,
  processReservations,
} from './services/reservation';

import {
  allDatesCovered,
  getUpcomingBookableDates,
  loadState,
  saveState,
  updateState,
} from './services/state';

import {
  isCI,
  baseUrl,
  email,
  password,
  reservationsPreferences,
} from './config';

/**
 * Comprueba que las credenciales y las preferencias estén configuradas.
 */
function validateConfig(): boolean {
  const missing: string[] = [];

  if (!email) missing.push('EMAIL');
  if (!password) missing.push('PASSWORD');

  if (missing.length > 0) {
    console.error(
      `Faltan las siguientes variables: ${missing.join(', ')}\n` +
      'Configúralas en Settings → Secrets and variables → Actions.'
    );

    return false;
  }

  const hasAnyDay = Object.values(reservationsPreferences).some(
    value => value !== null && value.trim() !== ''
  );

  if (!hasAnyDay) {
    console.error(
      'No hay días configurados. Revisa las variables MONDAY…SUNDAY.'
    );

    return false;
  }

  return true;
}

async function main(): Promise<void> {
  if (!validateConfig()) {
    process.exitCode = 1;
    return;
  }

  const state = loadState();
  const upcomingDates = getUpcomingBookableDates();
  const dryRun = process.env.DRY_RUN !== 'false';
  
  if (!dryRun && allDatesCovered(state, upcomingDates)) {
    console.log(
      'Todas las reservas configuradas ya están gestionadas. No es necesario repetir el proceso.'
    );
    return;
  }

  const browser = await launch({
    headless: isCI,
    slowMo: isCI ? 0 : 50,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  try {
    console.log('Abriendo el navegador...');

    const page = await browser.newPage();

    await page.setViewport({
      width: 1280,
      height: 720,
    });

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/91.0.4472.124 Safari/537.36'
    );

    const loginUrl = `${baseUrl}/account/login.aspx`;

    console.log('Abriendo la página de inicio de sesión...');

    await page.goto(loginUrl, {
      waitUntil: 'networkidle2',
    });

    console.log('Iniciando sesión...');

    await login(page, email, password);

    console.log('Accediendo al calendario de reservas...');

    await goToReservations(page);

    const dryRun = process.env.DRY_RUN !== 'false';

    console.log(
      dryRun
        ? 'MODO DE PRUEBA: se leerán las clases, pero no se realizarán reservas.'
        : 'MODO REAL: se procesarán las reservas configuradas.'
    );

const dayResults = await processReservations(
  page,
  reservationsPreferences
);

    const newState = updateState(
      state,
      dayResults.map(({ result }) => ({
        date: result.date,
        result,
      }))
    );

    saveState(newState);

    console.log('Estado de las reservas actualizado.');

    const successful = dayResults.filter(
      ({ result }) => result.success
    ).length;

    const unsuccessful = dayResults.length - successful;

    console.log('------------------------------');
    console.log(dryRun ? 'RESUMEN DE LA PRUEBA' : 'RESUMEN DE RESERVAS');
    console.log(`Clases encontradas o ya reservadas: ${successful}`);
    console.log(`Clases no encontradas o pendientes: ${unsuccessful}`);
    console.log('------------------------------');

  } catch (error) {
    console.error(
      'Error durante la ejecución:',
      error instanceof Error ? error.message : error
    );

    process.exitCode = 1;

  } finally {
    await browser.close();
    console.log('Proceso finalizado.');
  }
}

main();
