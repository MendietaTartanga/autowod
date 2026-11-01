import { ReservationPreferences } from './types';

export const baseUrl = 'https://wodbuster.com';

export const email = process.env.EMAIL ?? '';
export const password = process.env.PASSWORD ?? '';
export const twoCaptchaApiKey = process.env.TWO_CAPTCHA_API_KEY ?? '';
export const isCI = process.env.CI === 'true';

function parsePreferences(value: string | undefined): string[] {
  if (!value) return [];

  return value
    .split(';')
    .map(preference => preference.trim())
    .filter(preference => preference.length > 0);
}

export const reservationsPreferences: ReservationPreferences = {
  monday: parsePreferences(process.env.MONDAY),
  tuesday: parsePreferences(process.env.TUESDAY),
  wednesday: parsePreferences(process.env.WEDNESDAY),
  thursday: parsePreferences(process.env.THURSDAY),
  friday: parsePreferences(process.env.FRIDAY),
  saturday: parsePreferences(process.env.SATURDAY),
  sunday: parsePreferences(process.env.SUNDAY),
};

export const availableDays = Number(process.env.AVAILABLE_DAYS || 7);
