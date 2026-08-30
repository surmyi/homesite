import assert from 'node:assert/strict';
import test from 'node:test';

import { firstHistoryDates, historyDateRange } from '../lib/finance-history.ts';

test('monthly snapshots keep the first qualifying report in each month', () => {
  assert.deepEqual(
    firstHistoryDates(
      ['2026-08-20', '2026-07-14', '2026-08-02', '2026-07-01', '2026-08-02'],
      'monthly',
    ),
    ['2026-07-01', '2026-08-02'],
  );
});

test('annual snapshots keep the first qualifying report in each year', () => {
  assert.deepEqual(
    firstHistoryDates(
      ['2026-08-20', '2024-11-04', '2026-01-09', '2024-02-18'],
      'annual',
    ),
    ['2024-02-18', '2026-01-09'],
  );
});

test('daily snapshots retain every unique qualifying report', () => {
  assert.deepEqual(
    firstHistoryDates(['2026-08-20', '2026-08-18', '2026-08-20'], 'daily'),
    ['2026-08-18', '2026-08-20'],
  );
});

test('cadence filtering happens after the selected date range', () => {
  assert.deepEqual(firstHistoryDates(['2026-08-20', '2026-08-28'], 'monthly'), [
    '2026-08-20',
  ]);
});

test('cadence filtering can skip reports without the selected category', () => {
  assert.deepEqual(
    firstHistoryDates(
      ['2026-07-01', '2026-07-08', '2026-08-01'],
      'monthly',
      (date) => date !== '2026-07-01',
    ),
    ['2026-07-08', '2026-08-01'],
  );
});

test('rolling ranges are inclusive and anchored to the latest report', () => {
  const dates = ['2024-01-01', '2026-08-30'];
  assert.deepEqual(historyDateRange(dates, '30d'), {
    from: '2026-08-01',
    to: '2026-08-30',
  });
  assert.deepEqual(historyDateRange(dates, '90d'), {
    from: '2026-06-02',
    to: '2026-08-30',
  });
  assert.deepEqual(historyDateRange(dates, '1y'), {
    from: '2025-08-30',
    to: '2026-08-30',
  });
});

test('all dates uses the true dataset bounds regardless of input order', () => {
  assert.deepEqual(
    historyDateRange(['2026-08-30', '2024-01-01', '2025-06-01'], 'all'),
    {
      from: '2024-01-01',
      to: '2026-08-30',
    },
  );
});

test('one-year ranges clamp leap day to February 28', () => {
  assert.deepEqual(historyDateRange(['2020-01-01', '2024-02-29'], '1y'), {
    from: '2023-02-28',
    to: '2024-02-29',
  });
});

test('custom ranges accept arbitrary valid in-range boundaries', () => {
  assert.deepEqual(
    historyDateRange(['2024-01-01', '2026-08-30'], 'custom', {
      from: '2025-03-12',
      to: '2025-07-19',
    }),
    { from: '2025-03-12', to: '2025-07-19' },
  );
});

test('empty data produces an empty range', () => {
  assert.deepEqual(historyDateRange([], '30d'), { from: '', to: '' });
});
