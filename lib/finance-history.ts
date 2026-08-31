export type HistoryCadence = 'daily' | 'monthly' | 'annual';
export type HistoryRangePreset = '30d' | '90d' | '1y' | 'all' | 'custom';

export type HistoryDateRange = {
  from: string;
  to: string;
};

export function defaultHistoryRange(
  cadence: HistoryCadence,
): HistoryRangePreset {
  if (cadence === 'monthly') return '1y';
  if (cadence === 'annual') return 'all';
  return '30d';
}

export function historyRangeAfterCadenceChange(
  currentPreset: HistoryRangePreset,
  cadence: HistoryCadence,
): HistoryRangePreset {
  return currentPreset === 'custom'
    ? currentPreset
    : defaultHistoryRange(cadence);
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function periodKey(date: string, cadence: HistoryCadence) {
  if (cadence === 'daily') return date;
  return cadence === 'monthly' ? date.slice(0, 7) : date.slice(0, 4);
}

export function firstHistoryDates(
  dates: string[],
  cadence: HistoryCadence,
  hasData: (date: string) => boolean = () => true,
) {
  const firstByPeriod = new Map<string, string>();
  for (const date of [...new Set(dates)].sort()) {
    if (!hasData(date)) continue;
    const key = periodKey(date, cadence);
    if (!firstByPeriod.has(key)) firstByPeriod.set(key, date);
  }
  return Array.from(firstByPeriod.values());
}

function subtractDays(date: string, days: number) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() - days);
  return isoDate(result);
}

function subtractYear(date: string) {
  const source = new Date(`${date}T00:00:00Z`);
  const year = source.getUTCFullYear() - 1;
  const month = source.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return isoDate(
    new Date(Date.UTC(year, month, Math.min(source.getUTCDate(), lastDay))),
  );
}

export function historyDateRange(
  dates: string[],
  preset: HistoryRangePreset,
  custom?: HistoryDateRange,
): HistoryDateRange {
  const sorted = [...new Set(dates)].sort();
  const minDate = sorted[0] ?? '';
  const maxDate = sorted.at(-1) ?? '';
  if (!minDate || !maxDate) return { from: '', to: '' };

  if (
    preset === 'custom' &&
    custom?.from &&
    custom.to &&
    custom.from <= custom.to
  ) {
    return custom;
  }
  if (preset === 'all' || preset === 'custom')
    return { from: minDate, to: maxDate };

  const requestedFrom =
    preset === '30d'
      ? subtractDays(maxDate, 29)
      : preset === '90d'
        ? subtractDays(maxDate, 89)
        : subtractYear(maxDate);
  return {
    from: requestedFrom < minDate ? minDate : requestedFrom,
    to: maxDate,
  };
}
