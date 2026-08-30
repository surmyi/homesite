export type ComparisonPeriod = 'dd' | 'mm' | 'yy' | 'ytd';

type ComparisonWindow = {
  start: string;
  end: string;
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function comparisonWindow(
  latestDate: string | undefined,
  period: ComparisonPeriod,
): ComparisonWindow | null {
  if (!latestDate) return null;
  const latest = new Date(`${latestDate}T00:00:00Z`);
  if (Number.isNaN(latest.valueOf())) return null;

  if (period === 'dd') {
    latest.setUTCDate(latest.getUTCDate() - 1);
    const target = isoDate(latest);
    return { start: target, end: target };
  }

  if (period === 'mm') {
    const start = new Date(
      Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth() - 1, 1),
    );
    const end = new Date(
      Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth(), 0),
    );
    return { start: isoDate(start), end: isoDate(end) };
  }

  if (period === 'yy') {
    const year = latest.getUTCFullYear() - 1;
    return { start: `${year}-01-01`, end: `${year}-12-31` };
  }

  return { start: `${latest.getUTCFullYear()}-01-01`, end: latestDate };
}

export function firstComparisonDate(
  dates: string[],
  latestDate: string | undefined,
  period: ComparisonPeriod,
  hasData: (date: string) => boolean = () => true,
) {
  const window = comparisonWindow(latestDate, period);
  if (!window) return null;
  return (
    [...dates]
      .sort()
      .find(
        (date) => date >= window.start && date <= window.end && hasData(date),
      ) ?? null
  );
}
