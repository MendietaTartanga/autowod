import { appendFileSync } from 'fs';
import { Page, ElementHandle } from 'puppeteer';
import {
  ButtonText,
  ReservationPreferences,
  ReservationResult,
  WeekDay,
} from '../types';
import { availableDays } from '../config';

interface ParsedPreference {
  time: string;
  className: string;
}

const VALID_BUTTON_STATES: ButtonText[] = [
  'Entrenar',
  'Avisar',
  'Borrar',
  'Cambiar',
  'Finalizada',
];

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s*\+\s*/g, '+')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parsePreferenceValues(
  value: string | null
): ParsedPreference[] {
  if (!value) return [];

  return value
    .split(';')
    .map(item => {
      const separatorIndex = item.indexOf('|');

      if (separatorIndex === -1) return null;

      const time = item.slice(0, separatorIndex).trim();
      const className = item.slice(separatorIndex + 1).trim();

      if (!/^\d{2}:\d{2}$/.test(time) || !className) {
        return null;
      }

      return { time, className };
    })
    .filter((item): item is ParsedPreference => item !== null);
}

export async function goToReservations(page: Page): Promise<void> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const todayInSeconds = Math.floor(today.getTime() / 1000);
  // El calendario pertenece al centro Anboto, no al dominio público.
  const currentDomain = 'https://anboto.wodbuster.com';

  await page.goto(
    `${currentDomain}/athlete/reservas.aspx?t=${todayInSeconds}`,
    { waitUntil: 'networkidle2' }
  );

  const diagnostic = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    bodyText: (document.body?.innerText ?? '').slice(0, 5000),
    rowClaseCount: document.querySelectorAll('.rowClase').length,
    links: Array.from(document.querySelectorAll('a'))
      .map(a => ({ text: (a.innerText ?? '').trim(), href: a.href }))
      .filter(a => a.text || a.href)
      .slice(0, 40),
  }));
  console.log('Diagnóstico del calendario:', JSON.stringify(diagnostic));

  await page.waitForSelector('.rowClase', { timeout: 30000 });
}

export async function getReservationState(
  reservationButton: ElementHandle<Element>
): Promise<ButtonText | null> {
  const buttonText = await reservationButton.evaluate(
    el => el.textContent?.trim() ?? ''
  );

  return VALID_BUTTON_STATES.includes(buttonText as ButtonText)
    ? (buttonText as ButtonText)
    : null;
}

export function getReservationKey(time: string): string {
  return `h${time.replace(':', '')}00`;
}

export async function goToNextDay(page: Page): Promise<void> {
  await page.waitForSelector('a.next', { visible: true });
  await page.click('a.next');

  await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
}

function getTimestampFromUrl(page: Page): number {
  const url = new URL(page.url());
  const timestamp = Number(url.searchParams.get('t'));

  if (!Number.isFinite(timestamp)) {
    throw new Error('No se ha podido obtener la fecha del calendario.');
  }

  return timestamp;
}

export async function getWeekDayFromUrl(page: Page): Promise<string> {
  const date = new Date(getTimestampFromUrl(page) * 1000);

  return date
    .toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'UTC',
    })
    .toLowerCase();
}

export async function getDateFromUrl(page: Page): Promise<string> {
  const date = new Date(getTimestampFromUrl(page) * 1000);

  return Intl.DateTimeFormat('es-ES', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function getISODateFromUrl(page: Page): string {
  return new Date(getTimestampFromUrl(page) * 1000)
    .toISOString()
    .split('T')[0];
}

/**
 * Busca exclusivamente la actividad configurada.
 */
async function findReservationRow(
  page: Page,
  time: string,
  className: string
): Promise<ElementHandle<Element> | null> {
  const rows = await page.$$('.rowClase');

  const expectedClass = normalizeText(className);

  for (const row of rows) {
    const rowTime = await row.$eval(
      '.entrenamientoHead .hora',
      el => el.textContent?.trim() ?? ''
    ).catch(() => '');

    const rowClass = await row.$eval(
      '.entrenamientoHead .entrenamiento',
      el => el.textContent?.trim() ?? ''
    ).catch(() => '');

    if (rowTime !== time) continue;

    if (!normalizeText(rowClass).includes(expectedClass)) continue;

    return row;
  }

  return null;
}
/**
 * Solo devuelve botones de acción reconocidos.
 */
async function findActionButton(
  row: ElementHandle<Element>
): Promise<{
  button: ElementHandle<Element>;
  state: ButtonText;
  label: string;
} | null> {
  const buttons = await row.$$('.actionsjs button');

  for (const button of buttons) {
    const label = await button.evaluate(
      (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    );

    // WodBuster muestra la lista de espera como "Avisar" o "Avisar (5)".
    // El número indica cuántas personas hay esperando, no forma parte del estado.
    const isWaitlistButton = /^Avisar(?:\s*\(\d+\))?$/i.test(label);
    const state = isWaitlistButton ? 'Avisar' : await getReservationState(button);

    if (state) {
      return { button, state, label };
    }
  }

  return null;
}

/**
 * Comprueba el estado después de solicitar una reserva.
 */
async function verifyReservation(
  page: Page,
  time: string,
  className: string
): Promise<ButtonText | null> {
  await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});

  const row = await findReservationRow(page, time, className);

  if (!row) return null;

  const action = await findActionButton(row);

  return action?.state ?? null;
}
export async function inspectReservation(
  page: Page,
  preference: ParsedPreference
): Promise<ReservationResult> {
  const { time, className } = preference;

  const weekDay = await getWeekDayFromUrl(page);
  const date = getISODateFromUrl(page);

  const preferenceKey = `${date}|${time}|${normalizeText(className)}`;

  const row = await findReservationRow(page, time, className);

  if (!row) {
    return {
      success: false,
      message: `NO ENCONTRADA: ${className} a las ${time} el ${date}.`,
      weekDay,
      date,
      time,
      className,
      preferenceKey,
    };
  }

  const action = await findActionButton(row);

  if (!action) {
    return {
      success: false,
      message: `CLASE ENCONTRADA, pero sin botón de acción reconocido: ${className} a las ${time}.`,
      weekDay,
      date,
      time,
      className,
      preferenceKey,
    };
  }

  return {
    success: action.state === 'Borrar',
    message: action.state === 'Avisar'
      ? `CLASE COMPLETA: ${className} a las ${time}. Lista de espera disponible (${action.label}). No se ha realizado ninguna acción.`
      : action.state === 'Finalizada'
        ? `FINALIZADA: ${className} a las ${time}. No se ha realizado ninguna acción.`
        : `ENCONTRADA: ${className} a las ${time}. Estado del botón: ${action.label}. No se ha realizado ninguna acción.`,
    weekDay,
    date,
    time,
    className,
    preferenceKey,
    state: action.state,
  };
}
export async function makeReservation(
  page: Page,
  preference: ParsedPreference
): Promise<ReservationResult> {
  const { time, className } = preference;

  const weekDay = await getWeekDayFromUrl(page);
  const date = getISODateFromUrl(page);

  const preferenceKey = `${date}|${time}|${normalizeText(className)}`;

  const row = await findReservationRow(page, time, className);

  if (!row) {
    return {
      success: false,
      message: `No se encuentra ${className} a las ${time} el ${date}.`,
      weekDay,
      date,
      time,
      className,
      preferenceKey,
    };
  }

  const action = await findActionButton(row);

  if (!action) {
    return {
      success: false,
      message: `No se ha encontrado un botón válido para ${className} a las ${time}.`,
      weekDay,
      date,
      time,
      className,
      preferenceKey,
    };
  }

  const result: ReservationResult = {
    success: false,
    message: '',
    weekDay,
    date,
    time,
    className,
    preferenceKey,
    state: action.state,
  };

  switch (action.state) {
    case 'Entrenar': {
      await action.button.click();

      const newState = await verifyReservation(
        page,
        time,
        className
      );

      if (newState === 'Borrar') {
        result.success = true;
        result.message = `Inscripción confirmada: ${className} a las ${time}.`;
        result.state = 'Borrar';
      } else {
        result.message = `No se ha podido confirmar la inscripción de ${className} a las ${time}.`;
      }

      break;
    }

    case 'Avisar': {
      await action.button.click();

      const newState = await verifyReservation(
        page,
        time,
        className
      );

      if (newState === 'Borrar') {
        result.success = true;
        result.message = `Inscripción confirmada: ${className} a las ${time}.`;
        result.state = 'Borrar';
      } else {
        result.message = `Se ha solicitado la lista de espera de ${className} a las ${time}, pero no se ha podido verificar.`;
      }

      break;
    }

    case 'Borrar':
      result.success = true;
      result.message = `Ya estabas inscrita en ${className} a las ${time}.`;
      break;

    case 'Cambiar':
      result.message = 'Ya tienes otra reserva en ese horario. No se ha cambiado.';
      break;

    case 'Finalizada':
      result.message = `La clase ${className} a las ${time} ya ha finalizado.`;
      break;
  }

  return result;
}

/**
 * Escribe el resumen de GitHub Actions.
 * Recibe los resultados agrupados por día.
 */
function writeJobSummary(
  results: Array<{
    weekDay: string;
    result: ReservationResult;
  }>
): void {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;

  if (!summaryFile) return;

  const rows = results.map(({ weekDay, result }) => {
    const status = result.success
      ? result.message
      : `Pendiente: ${result.message}`;

    return `| ${weekDay} | ${result.date ?? '—'} | ${result.time ?? '—'} | ${result.className ?? '—'} | ${status} |`;
  });

  const lines = [
    '## Resultados de AutoWOD',
    '',
    '| Día | Fecha | Hora | Actividad | Resultado |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ];

  appendFileSync(summaryFile, lines.join('\n'));
}

export async function processReservations(
  page: Page,
  preferences: ReservationPreferences
): Promise<Array<{ weekDay: string; result: ReservationResult }>> {
  const dayResults: Array<{
    weekDay: string;
    result: ReservationResult;
  }> = [];

  for (let i = 0; i < availableDays; i++) {
    const weekDay = await getWeekDayFromUrl(page);
    const preferenceValue = preferences[weekDay as WeekDay];

    const preferencesForDay = parsePreferenceValues(preferenceValue);

    for (const preference of preferencesForDay) {
      const dryRun = process.env.DRY_RUN !== 'false';
      
      const result = dryRun
        ? await inspectReservation(page, preference)
        : await makeReservation(page, preference);

      dayResults.push({ weekDay, result });

      console.log(result.message);
    }

    if (i === availableDays - 1) break;

    const dateBefore = getISODateFromUrl(page);

    await goToNextDay(page);

    if (getISODateFromUrl(page) === dateBefore) {
      console.log(
        `El calendario no avanza desde ${dateBefore}. Se detiene el proceso.`
      );
      break;
    }
  }

  writeJobSummary(dayResults);

  return dayResults;
}
