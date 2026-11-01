
import { existsSync, readFileSync, writeFileSync } from 'fs';

import {
  BookingState,
  ReservationResult,
  TerminalBookingStatus,
  WeekDay,
} from '../types';

import {
  availableDays,
  reservationsPreferences,
} from '../config';

import { parsePreferenceValues } from './reservation';

const STATE_FILE = 'booking-state.json';

const TIME_ZONE = 'Europe/Madrid';

const TERMINAL: TerminalBookingStatus[] = [
  'booked',
  'waitlisted',
  'finished',
  'different-time',
];

const WEEK_DAY_NAMES: WeekDay[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/**
 * Normaliza el nombre de la actividad.
 */
function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Obtiene la fecha actual en la zona horaria de España.
 */
function getTodayInMadrid(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('No se ha podido calcular la fecha de España.');
  }

  return `${year}-${month}-${day}`;
}

/**
 * Identifica una reserva concreta:
 * fecha + hora + actividad.
 */
function createBookingKey(
  date: string,
  time: string,
  className: string
): string {
  return `${date}|${time}|${normalizeText(className)}`;
}

/**
 * Carga el estado de las reservas.
 */
export function loadState(): BookingState {
  if (!existsSync(STATE_FILE)) {
    return {};
  }

  try {
    const data: unknown = JSON.parse(
      readFileSync(STATE_FILE, 'utf-8')
    );

    if (
      typeof data !== 'object' ||
      data === null ||
      Array.isArray(data)
    ) {
      console.warn(
        'El archivo de estado no tiene un formato válido. Se inicia un estado vacío.'
      );

      return {};
    }

    return data as BookingState;
  } catch {
    console.warn(
      'No se ha podido leer booking-state.json. Se inicia un estado vacío.'
    );

    return {};
  }
}

/**
 * Guarda el estado de las reservas.
 */
export function saveState(state: BookingState): void {
  writeFileSync(
    STATE_FILE,
    JSON.stringify(state, null, 2),
    'utf-8'
  );
}

/**
 * Elimina del estado las reservas de fechas anteriores a hoy
 * en la zona horaria de España.
 */
function pruneOldDates(state: BookingState): BookingState {
  const todayISO = getTodayInMadrid();

  return Object.fromEntries(
    Object.entries(state).filter(([key]) => {
      const date = key.split('|')[0];

      return /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        date >= todayISO;
    })
  );
}

/**
 * Obtiene las fechas que se van a revisar.
 * Los días se calculan utilizando el calendario de España.
 */
export function getUpcomingBookableDates(): string[] {
  const dates: string[] = [];

  const todayISO = getTodayInMadrid();

  // Utilizamos UTC únicamente para sumar días de calendario.
  // Así evitamos problemas con los cambios de hora de España.
  const today = new Date(`${todayISO}T00:00:00Z`);

  for (let i = 0; i < availableDays; i++) {
    const date = new Date(today);

    date.setUTCDate(date.getUTCDate() + i);

    const dateISO = date.toISOString().split('T')[0];
    const weekDay = WEEK_DAY_NAMES[date.getUTCDay()];

    if (reservationsPreferences[weekDay]) {
      dates.push(dateISO);
    }
  }

  return dates;
}

/**
 * Comprueba si todas las reservas configuradas
 * están gestionadas definitivamente.
 */
export function allDatesCovered(
  state: BookingState,
  dates: string[]
): boolean {
  if (dates.length === 0) {
    return false;
  }

  for (const dateString of dates) {
    const date = new Date(`${dateString}T00:00:00Z`);

    const weekDay = WEEK_DAY_NAMES[date.getUTCDay()];

    const preferences = parsePreferenceValues(
      reservationsPreferences[weekDay]
    );

    for (const preference of preferences) {
      const key = createBookingKey(
        dateString,
        preference.time,
        preference.className
      );

      if (!TERMINAL.includes(state[key])) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Traduce el resultado de una reserva a un estado permanente.
 */
export function terminalStatusFromResult(
  result: ReservationResult
): TerminalBookingStatus | null {
  const { state, success } = result;

  if (state === 'Borrar') {
    return 'booked';
  }

  if (state === 'Finalizada') {
    return 'finished';
  }

  if (state === 'Cambiar') {
    return 'different-time';
  }

  if (state === 'Entrenar' && success) {
    return 'booked';
  }

  if (state === 'Avisar' && success) {
    return 'waitlisted';
  }

  // Las clases no encontradas o no disponibles
  // podrán volver a intentarse en la siguiente ejecución.
  return null;
}

/**
 * Actualiza el estado individual de cada reserva.
 */
export function updateState(
  current: BookingState,
  dayResults: Array<{
    date?: string;
    result: ReservationResult;
  }>
): BookingState {
  const next = pruneOldDates(current);

  for (const { date, result } of dayResults) {
    if (!date || !result.time || !result.className) {
      continue;
    }

    const key = createBookingKey(
      date,
      result.time,
      result.className
    );

    const status = terminalStatusFromResult(result);

    if (status) {
      next[key] = status;
    }
  }

  return next;
}
