
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';

vi.mock('../config', () => ({
  availableDays: 7,
  reservationsPreferences: {
    monday: '17:15|Open',
    tuesday: '17:15|Open;18:15|WOD',
    wednesday: '15:30|Open',
    thursday: '17:15|Open',
    friday: '15:30|Open',
    saturday: '10:00|Open;11:00|WOD',
    sunday: null,
  },
}));

import {
  allDatesCovered,
  updateState,
  terminalStatusFromResult,
  getUpcomingBookableDates,
} from '../services/state';

import type { ReservationResult } from '../types';

function makeResult(
  state?: ReservationResult['state'],
  success = false,
  time = '17:15',
  className = 'Open'
): ReservationResult {
  return {
    success,
    message: '',
    weekDay: 'monday',
    state,
    time,
    className,
  };
}

describe('terminalStatusFromResult', () => {
  it('maps Borrar to booked', () => {
    expect(
      terminalStatusFromResult(makeResult('Borrar'))
    ).toBe('booked');
  });

  it('maps Finalizada to finished', () => {
    expect(
      terminalStatusFromResult(makeResult('Finalizada'))
    ).toBe('finished');
  });

  it('maps Cambiar to different-time', () => {
    expect(
      terminalStatusFromResult(makeResult('Cambiar'))
    ).toBe('different-time');
  });

  it('maps successful Entrenar to booked', () => {
    expect(
      terminalStatusFromResult(makeResult('Entrenar', true))
    ).toBe('booked');
  });

  it('maps successful Avisar to waitlisted', () => {
    expect(
      terminalStatusFromResult(makeResult('Avisar', true))
    ).toBe('waitlisted');
  });

  it('returns null for failed Entrenar', () => {
    expect(
      terminalStatusFromResult(makeResult('Entrenar', false))
    ).toBeNull();
  });

  it('returns null for failed Avisar', () => {
    expect(
      terminalStatusFromResult(makeResult('Avisar', false))
    ).toBeNull();
  });

  it('returns null when no button state exists', () => {
    expect(
      terminalStatusFromResult(makeResult(undefined))
    ).toBeNull();
  });
});

describe('allDatesCovered', () => {
  it('returns false for an empty dates list', () => {
    expect(allDatesCovered({}, [])).toBe(false);
  });

  it('returns false when the date is not in state', () => {
    expect(
      allDatesCovered({}, ['2026-05-19'])
    ).toBe(false);
  });

  it('returns true when all preferences have terminal status', () => {
    const state = {
      '2026-05-19|17:15|open': 'booked' as const,
      '2026-05-19|18:15|wod': 'finished' as const,
    };

    expect(
      allDatesCovered(state, ['2026-05-19'])
    ).toBe(true);
  });

  it('returns false when only some preferences are covered', () => {
    const state = {
      '2026-05-19|17:15|open': 'booked' as const,
    };

    expect(
      allDatesCovered(state, ['2026-05-19'])
    ).toBe(false);
  });

  it('returns false when only some dates are covered', () => {
    const state = {
      '2026-05-19|17:15|open': 'booked' as const,
      '2026-05-19|18:15|wod': 'finished' as const,
    };

    expect(
      allDatesCovered(state, [
        '2026-05-19',
        '2026-05-20',
      ])
    ).toBe(false);
  });

  it('accepts all four terminal statuses', () => {
    const state = {
      '2026-05-19|17:15|open': 'booked' as const,
      '2026-05-19|18:15|wod': 'waitlisted' as const,
      '2026-05-20|15:30|open': 'finished' as const,
      '2026-05-21|17:15|open': 'different-time' as const,
    };

    expect(
      allDatesCovered(state, [
        '2026-05-19',
        '2026-05-20',
        '2026-05-21',
      ])
    ).toBe(true);
  });
});

describe('getUpcomingBookableDates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calculates dates using the Europe/Madrid timezone', () => {
    // 18 de mayo a las 23:30 UTC:
    // en España ya es 19 de mayo.
    vi.setSystemTime(
      new Date('2026-05-18T23:30:00Z')
    );

    expect(getUpcomingBookableDates()).toEqual([
      '2026-05-19',
      '2026-05-20',
      '2026-05-21',
      '2026-05-22',
      '2026-05-23',
      '2026-05-25',
    ]);
  });
});

describe('updateState', () => {
  beforeEach(() => {
    vi.useFakeTimers();

    vi.setSystemTime(
      new Date('2026-05-19T12:00:00Z')
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds a newly booked reservation', () => {
    const next = updateState({}, [
      {
        date: '2026-05-19',
        result: makeResult('Borrar'),
      },
    ]);

    expect(
      next['2026-05-19|17:15|open']
    ).toBe('booked');
  });

  it('adds a waitlisted reservation', () => {
    const next = updateState({}, [
      {
        date: '2026-05-20',
        result: makeResult(
          'Avisar',
          true,
          '15:30',
          'Open'
        ),
      },
    ]);

    expect(
      next['2026-05-20|15:30|open']
    ).toBe('waitlisted');
  });

  it('prunes dates before today', () => {
    const next = updateState(
      {
        '2026-05-18|17:15|open': 'booked',
      },
      []
    );

    expect(
      next['2026-05-18|17:15|open']
    ).toBeUndefined();
  });

  it('keeps today and future dates', () => {
    const existing = {
      '2026-05-19|17:15|open': 'booked' as const,
      '2026-05-25|17:15|open': 'waitlisted' as const,
    };

    const next = updateState(existing, []);

    expect(
      next['2026-05-19|17:15|open']
    ).toBe('booked');

    expect(
      next['2026-05-25|17:15|open']
    ).toBe('waitlisted');
  });

  it('skips results with no terminal status', () => {
    const next = updateState({}, [
      {
        date: '2026-05-19',
        result: makeResult('Entrenar', false),
      },
    ]);

    expect(Object.keys(next)).toHaveLength(0);
  });

  it('skips results with no date', () => {
    const next = updateState({}, [
      {
        date: undefined,
        result: makeResult('Borrar'),
      },
    ]);

    expect(Object.keys(next)).toHaveLength(0);
  });

  it('skips results without time or class name', () => {
    const result = {
      ...makeResult('Borrar'),
      time: undefined,
    };

    const next = updateState({}, [
      {
        date: '2026-05-19',
        result,
      },
    ]);

    expect(Object.keys(next)).toHaveLength(0);
  });
});
