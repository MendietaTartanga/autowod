import type { ReservationPreferences } from './types';

export const baseUrl = 'https://anboto.wodbuster.com';

// Credenciales de acceso.
export const email = process.env.EMAIL ?? '';
export const password = process.env.PASSWORD ?? '';

// Clave de 2Captcha, si el proyecto la necesita.
// No se debe utilizar para saltarse verificaciones CAPTCHA.
export const twoCaptchaApiKey =
  process.env.TWO_CAPTCHA_API_KEY ?? '';

// Detecta si se está ejecutando en GitHub Actions.
export const isCI = process.env.CI === 'true';

// Preferencias semanales de reservas.
export const reservationsPreferences: ReservationPreferences = {
  monday: process.env.MONDAY || null,
  tuesday: process.env.TUESDAY || null,
  wednesday: process.env.WEDNESDAY || null,
  thursday: process.env.THURSDAY || null,
  friday: process.env.FRIDAY || null,
  saturday: process.env.SATURDAY || null,
  sunday: process.env.SUNDAY || null,
};

// Número de días que se revisarán.
const configuredAvailableDays = Number(
  process.env.AVAILABLE_DAYS || 7
);

if (
  !Number.isInteger(configuredAvailableDays) ||
  configuredAvailableDays < 1 ||
  configuredAvailableDays > 7
) {
  throw new Error(
    'AVAILABLE_DAYS debe ser un número entero entre 1 y 7.'
  );
}

export const availableDays = configuredAvailableDays;

