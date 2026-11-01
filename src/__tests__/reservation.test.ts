
import { describe, it, expect } from 'vitest';

import {
  parsePreferenceValues,
  getReservationKey,
} from '../services/reservation';

describe('parsePreferenceValues', () => {
  it('returns an empty array for null input', () => {
    expect(parsePreferenceValues(null)).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(parsePreferenceValues('')).toEqual([]);
  });

  it('parses a time and class name', () => {
    expect(parsePreferenceValues('17:00|CrossFit')).toEqual([
      { time: '17:00', className: 'CrossFit' },
    ]);
  });

  it('trims whitespace from time and class name', () => {
    expect(parsePreferenceValues(' 09:00 | WOD ')).toEqual([
      { time: '09:00', className: 'WOD' },
    ]);
  });

  it('parses multiple preferences separated by semicolons', () => {
    expect(
      parsePreferenceValues('17:15|Open;18:15|WOD')
    ).toEqual([
      { time: '17:15', className: 'Open' },
      { time: '18:15', className: 'WOD' },
    ]);
  });

  it('ignores preferences without a separator', () => {
    expect(
      parsePreferenceValues('17:00|Open;invalid;18:15|WOD')
    ).toEqual([
      { time: '17:00', className: 'Open' },
      { time: '18:15', className: 'WOD' },
    ]);
  });

  it('ignores preferences with an invalid time format', () => {
    expect(
      parsePreferenceValues(
        '7:00|Open;17:0|WOD;17:00|CrossFit'
      )
    ).toEqual([
      { time: '17:00', className: 'CrossFit' },
    ]);
  });

  it('ignores hours greater than 23', () => {
    expect(
      parsePreferenceValues('24:00|Open;25:30|WOD')
    ).toEqual([]);
  });

  it('ignores minutes greater than 59', () => {
    expect(
      parsePreferenceValues('17:60|Open;18:99|WOD')
    ).toEqual([]);
  });

  it('ignores preferences without a class name', () => {
    expect(
      parsePreferenceValues('17:00|;18:00|WOD')
    ).toEqual([
      { time: '18:00', className: 'WOD' },
    ]);
  });

  it('accepts midnight and the last valid minute of the day', () => {
    expect(
      parsePreferenceValues('00:00|Open;23:59|WOD')
    ).toEqual([
      { time: '00:00', className: 'Open' },
      { time: '23:59', className: 'WOD' },
    ]);
  });
});

describe('getReservationKey', () => {
  it('formats evening time as reservation key', () => {
    expect(getReservationKey('17:00')).toBe('h170000');
  });

  it('formats morning time with leading zero', () => {
    expect(getReservationKey('09:30')).toBe('h093000');
  });

  it('formats midday time', () => {
    expect(getReservationKey('12:00')).toBe('h120000');
  });
});
