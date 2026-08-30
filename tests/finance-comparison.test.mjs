import assert from 'node:assert/strict';
import test from 'node:test';

import {
  comparisonWindow,
  firstComparisonDate,
} from '../lib/finance-comparison.ts';

const dates = [
  '2026-08-30',
  '2026-07-01',
  '2026-01-01',
  '2025-08-01',
  '2025-01-01',
];

test('M/M uses the first available report in the previous month', () => {
  assert.deepEqual(comparisonWindow('2026-08-30', 'mm'), {
    start: '2026-07-01',
    end: '2026-07-31',
  });
  assert.equal(firstComparisonDate(dates, '2026-08-30', 'mm'), '2026-07-01');
});

test('Y/Y uses the first available report in the previous year', () => {
  assert.equal(firstComparisonDate(dates, '2026-08-30', 'yy'), '2025-01-01');
});

test('YTD uses the first available report in the current year', () => {
  assert.equal(firstComparisonDate(dates, '2026-08-30', 'ytd'), '2026-01-01');
});

test('a period is N/A only when that period has no qualifying report', () => {
  assert.equal(
    firstComparisonDate(['2026-06-01', '2026-08-30'], '2026-08-30', 'mm'),
    null,
  );
  assert.equal(
    firstComparisonDate(
      ['2026-07-01', '2026-07-15'],
      '2026-08-30',
      'mm',
      (date) => date === '2026-07-15',
    ),
    '2026-07-15',
  );
});

test('D/D remains an exact previous-calendar-day comparison', () => {
  assert.equal(firstComparisonDate(['2026-08-28'], '2026-08-30', 'dd'), null);
  assert.equal(
    firstComparisonDate(['2026-08-29'], '2026-08-30', 'dd'),
    '2026-08-29',
  );
});

test('M/M crosses the year boundary correctly', () => {
  assert.deepEqual(comparisonWindow('2026-01-15', 'mm'), {
    start: '2025-12-01',
    end: '2025-12-31',
  });
});
