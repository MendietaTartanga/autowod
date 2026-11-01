import { appendFileSync } from 'fs';
import { Page, ElementHandle } from 'puppeteer';
import {
  ButtonText,
  ReservationPreferences,
  ReservationResult,
  WeekDay,
} from '../types';
import { availableDays } from '../config';

const ACTION_STATES: ButtonText[] = [
  'Entrenar',
  'Avisar',
  'Borrar',
  'Cambiar',
  'Finalizada',
];

export function parsePreferenceValue(value: string): {
  time: string | null;
  className: string | null;
} {
  const separator = value.indexOf('|');

  if (separator === -1) {
    return { time: null, className: null };
  }

  const time = value.substring(0, separator).trim();
  const className = value.substring(separator + 1).trim();

  if (!/^\d{2}:\d{2}$/.test(time) || !className) {
    return { time: null, className: null };
  }

  return { time, className };
}

export async function goToReservations(page: Page): Promise<void> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const todayInSeconds = Math.floor(today.getTime() / 1000);
  const currentDomain = new URL(page.url()).origin;

  await page.goto(
    `${currentDomain}/athlete/reservas.aspx?t=${todayInSeconds}`
  );
}

export async function getReservationState(
  reservationButton: ElementHandle<Element>
): Promise<ButtonText | null> {
  const buttonText = (
    await reservationButton.evaluate(el => el.textContent)
  )?.trim();

  if (!buttonText || !ACTION_STATES.includes(buttonText as ButtonText)) {
    return null;
  }

  return buttonText as ButtonText;
}

export function getReservationKey(time: string): string {
  return `h${time.replace(':', '')}00`;
}

export async function goToNextDay(page: Page): Promise<void> {
  await page.waitForSelector('a.next');
  await page.click('a.next');
  await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
}

export async function getWeekDayFromUrl(page: Page): Promise<string> {
  const url = await page.url();
  const weekDayInSeconds = url.split('=')[1];
  const weekDay = new Date(Number(weekDayInSeconds) * 1000);

  return weekDay
    .toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'UTC',
    })
    .toLowerCase();
}

export async function getDateFromUrl(page: Page): Promise<string> {
  const url = await page.url();
  const weekDayInSeconds = url.split('=')[1];

  return Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(Number(weekDayInSeconds) * 1000));
}

export function getISODateFromUrl(page: Page): string {
  const seconds = page.url().split('=')[1];

  return new Date(Number(seconds) * 1000)
    .toISOString()
    .split('T')[0];
}

/**
 * Busca exclusivamente botones de acción de reserva.
 * Ignora botones informativos como "Wod".
 *
 * Si hay varias coincidencias o no se puede identificar
 * inequívocamente la clase, no devuelve ningún botón.
 */
async function findReservationButton(
  page: Page,
  reservationKey: string,
  className: string
): Promise<ElementHandle<Element> | null> {
  const buttons = await page.$$(
    `div[data-magellan-destination="${reservationKey}"] button`
  );

  const matchingButtons: ElementHandle<Element>[] = [];

  const normalizedClassName = className
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  for (const button of buttons) {
    const state = await getReservationState(button);

    // Ignorar botones informativos, incluido "Wod".
    if (!state) continue;

    const matchesClass = await button.evaluate(
      (element, expectedClass) => {
        const normalize = (text: string) =>
          text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();

        const section = element.closest(
          '[data-magellan-destination]'
        );

        if (!section) return false;

        let current: Element | null = element.parentElement;

        while (current) {
          const text = normalize(current.textContent ?? '');

          if (text.includes(expectedClass)) {
            return true;
          }

          if (current === section) break;

          current = current.parentElement;
        }

        return false;
      },
      normalizedClassName
    );

    if (matchesClass) {
      matchingButtons.push(button);
    }
  }

  // No elegir nunca la primera opción como alternativa.
  if (matchingButtons.length !== 1) {
    console.log(
      `⚠️ ${matchingButtons.length} coincidencias para "${className}" en ${reservationKey}. No se reserva.`
    );

    return null;
  }

  return matchingButtons[0];
}

export async function makeReservation(
  page: Page,
  preference: string
): Promise<ReservationResult> {
  const { time, className } = parsePreferenceValue(preference);

  const weekDay = await getWeekDayFromUrl(page);
  const date = getISODateFromUrl(page);

  if (!time || !className) {
    return {
      success: false,
      message: `⚠️ Preferencia no válida: ${preference}`,
      weekDay,
      date,
    };
  }

  const reservationKey = getReservationKey(time);

  const reservationButton = await findReservationButton(
    page,
    reservationKey,
    className
  );

  if (!reservationButton) {
    return {
      success: false,
      message: `🔍 No se ha identificado exactamente "${className}" a las ${time}. No se ha reservado nada.`,
      weekDay,
      date,
      time,
    };
  }

  const state = await getReservationState(reservationButton);

  if (!state) {
    return {
      success: false,
      message: `⚠️ No se ha podido determinar el estado de ${className} a las ${time}.`,
      weekDay,
      date,
      time,
    };
  }

  const result: ReservationResult = {
    success: false,
    message: '',
    weekDay,
    date,
    time,
    state,
  };

  switch (state) {
    case 'Borrar':
      result.message = `ℹ️ ${className} a las ${time}: ya estaba reservada.`;
      return result;

    case 'Cambiar':
      result.message = `⚠️ ${className} a las ${time}: ya tienes otra franja reservada. No se modifica.`;
      return result;

    case 'Finalizada':
      result.message = `❌ ${className} a las ${time}: la clase ha finalizado.`;
      return result;

    case 'Entrenar':
    case 'Avisar':
      break;

    default:
      result.message = `⚠️ Estado no reconocido para ${className}.`;
      return result;
  }

  const previousState = state;

  await reservationButton.click();

  await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});

  // Volver a buscar la misma clase y comprobar el estado.
  const updatedButton = await findReservationButton(
    page,
    reservationKey,
    className
  );

  const updatedState = updatedButton
    ? await getReservationState(updatedButton)
    : null;

  if (updatedState === 'Borrar') {
    result.success = true;

    result.message =
      previousState === 'Entrenar'
        ? `✅ ${className} a las ${time}: reserva confirmada.`
        : `⏳ ${className} a las ${time}: solicitud de lista de espera confirmada en la interfaz.`;

    return result;
  }

  result.success = false;
  result.message =
    `⚠️ Se ha pulsado "${previousState}" para ${className} a las ${time}, ` +
    'pero no se ha podido verificar el cambio. Requiere comprobación manual.';

  return result;
}

function writeJobSummary(
  dayResults: Array<{ weekDay: string; result: ReservationResult }>,
  counts: {
    booked: number;
    waitlisted: number;
    alreadyBooked: number;
    skipped: number;
    other: number;
  }
): void {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;

  if (!summaryFile) return;

  const statusLabel = (result: ReservationResult): string => {
    if (!result.time) return '⏭️ Skipped';

    if (result.state === 'Entrenar' && result.success) {
      return '✅ Confirmed';
    }

    if (result.state === 'Avisar' && result.success) {
      return '⏳ Waitlisted';
    }

    if (result.state === 'Borrar') {
      return 'ℹ️ Already booked';
    }

    if (result.state === 'Finalizada') {
      return '❌ Finished';
    }

    if (result.state === 'Cambiar') {
      return '⚠️ Different time already booked';
    }

    return '⚠️ Not confirmed / not found';
  };

  const rows = dayResults.map(({ weekDay, result }) => {
    const day =
      weekDay.charAt(0).toUpperCase() + weekDay.slice(1);

    return `| ${day} | ${result.time ?? '—'} | ${statusLabel(result)} |`;
  });

  const totals = [
    counts.booked > 0 ? `**${counts.booked} confirmed**` : null,
    counts.waitlisted > 0 ? `${counts.waitlisted} waitlisted` : null,
    counts.alreadyBooked > 0
      ? `${counts.alreadyBooked} already booked`
      : null,
    counts.skipped > 0 ? `${counts.skipped} skipped` : null,
    counts.other > 0 ? `${counts.other} not confirmed` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const lines = [
    '## 🏋️ AutoWOD Booking Results',
    '',
    '| Day | Time | Status |',
    '|-----|------|--------|',
    ...rows,
    '',
    totals,
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

  let booked = 0;
  let waitlisted = 0;
  let alreadyBooked = 0;
  let other = 0;
  let skipped = 0;

  for (let i = 0; i < availableDays; i++) {
    const weekDay = await getWeekDayFromUrl(page);
    const date = getISODateFromUrl(page);

    const reservations =
      preferences[weekDay as WeekDay] ?? [];

    if (reservations.length === 0) {
      skipped++;

      dayResults.push({
        weekDay,
        result: {
          success: false,
          message: `⏭️ No reservations configured for ${weekDay}.`,
          weekDay,
          date,
        },
      });
    }

    // Procesar TODAS las reservas configuradas para este día.
    for (const preference of reservations) {
      const result = await makeReservation(page, preference);

      dayResults.push({ weekDay, result });
      console.log(result.message);

      if (result.state === 'Entrenar' && result.success) {
        booked++;
      } else if (result.state === 'Avisar' && result.success) {
        waitlisted++;
      } else if (result.state === 'Borrar') {
        alreadyBooked++;
      } else {
        other++;
      }
    }

    if (i === availableDays - 1) break;

    const dateBefore = getISODateFromUrl(page);

    await goToNextDay(page);

    if (getISODateFromUrl(page) === dateBefore) {
      console.log(
        `📆 ${dateBefore} is the last bookable day for now — stopping.`
      );

      break;
    }
  }

  console.log(
    `📊 Summary -> booked: ${booked}, waitlist: ${waitlisted}, already booked: ${alreadyBooked}, skipped: ${skipped}, other: ${other}`
  );

  writeJobSummary(dayResults, {
    booked,
    waitlisted,
    alreadyBooked,
    skipped,
    other,
  });

  return dayResults;
}
