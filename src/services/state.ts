
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
 * Normaliza el nombre de la actividad igual que reservation.ts.
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

export function loadState(): BookingState {
  if (!existsSync(STATE_FILE)) return {};

  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveState(state: BookingState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Elimina del estado las reservas de fechas anteriores a hoy.
 */
function pruneOldDates(state: BookingState): BookingState {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const todayISO = today.toISOString().split('T')[0];

  return Object.fromEntries(
    Object.entries(state).filter(([key]) => {
      const date = key.split('|')[0];
      return date >= todayISO;
    })
  );
}

/**
 * Obtiene las fechas que se van a revisar.
 */
export function getUpcomingBookableDates(): string[] {
  const dates: string[] = [];

  for (let i = 0; i < availableDays; i++) {
    const date = new Date();

    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() + i);

    const weekDay = WEEK_DAY_NAMES[date.getUTCDay()];

    if (reservationsPreferences[weekDay]) {
      dates.push(date.toISOString().split('T')[0]);
    }
  }

  return dates;
}

/**
 * Comprueba cada reserva configurada, no solamente cada día.
 * Si una clase todavía no está disponible, el proceso podrá reintentarlo.
 */
export function allDatesCovered(
  state: BookingState,
  dates: string[]
): boolean {
  if (dates.length === 0) return false;

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
 * Traduce el resultado de la reserva a un estado permanente.
 */
export function terminalStatusFromResult(
  result: ReservationResult
): TerminalBookingStatus | null {
  const { state, success } = result;

  if (state === 'Borrar') return 'booked';
  if (state === 'Finalizada') return 'finished';
  if (state === 'Cambiar') return 'different-time';

  if (state === 'Entrenar' && success) return 'booked';
  if (state === 'Avisar' && success) return 'waitlisted';

  // Si no se encuentra la clase o no está disponible,
  // no se guarda como estado definitivo. Se podrá reintentar.
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
    if (!date || !result.time || !result.className) continue;

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
