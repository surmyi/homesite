'use client';

import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  Banknote,
  CalendarRange,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Database,
  Gem,
  HeartPulse,
  History,
  House,
  Landmark,
  LayoutDashboard,
  LoaderCircle,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { Button } from '@/components/ui/button';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { firstComparisonDate, type ComparisonPeriod } from '@/lib/finance-comparison';
import {
  defaultHistoryRange,
  firstHistoryDates,
  historyDateRange,
  type HistoryCadence,
  type HistoryRangePreset,
} from '@/lib/finance-history';

type FinanceValue = {
  balance: number | null;
  ok: boolean;
  errorType: string | null;
} | null;

type FinanceAccount = {
  id: string;
  institution: string;
  account: string;
  lastFour: string | null;
  canonicalKey: string;
  categoryId: string;
};

type FinanceRow = {
  date: string;
  values: Record<string, FinanceValue>;
};

type FinanceCategory = {
  id: string;
  name: string;
  summaryGroup: string;
  balanceKind: 'asset' | 'debt';
  accounts: FinanceAccount[];
  rows: FinanceRow[];
};

type FinanceDashboardResponse = {
  portfolio: { id: string; name: string; currency: string };
  latestReportDate: string | null;
  lastIngestedAt: string | null;
  dates: string[];
  accountCount: number;
  summary: {
    columns: Array<{ id: string; name: string }>;
    rows: FinanceRow[];
  };
  categories: FinanceCategory[];
};

type FinanceView = 'overview' | 'history';
type ChartCadence = HistoryCadence;
type AggregateMetric = 'net' | 'assets' | 'debt';
type HistoryTrendMetric = AggregateMetric | 'group';

const COMPARISON_PERIODS: Array<{ id: ComparisonPeriod; label: string }> = [
  { id: 'dd', label: 'D/D' },
  { id: 'mm', label: 'M/M' },
  { id: 'yy', label: 'Y/Y' },
  { id: 'ytd', label: 'YTD' },
];

const GROUP_VISUALS: Record<string, { icon: LucideIcon; accent: string; wash: string }> = {
  cash: { icon: Banknote, accent: 'bg-emerald-500', wash: 'bg-emerald-500/10 text-emerald-700' },
  investment: { icon: ChartNoAxesCombined, accent: 'bg-sky-500', wash: 'bg-sky-500/10 text-sky-700' },
  retirements: { icon: ShieldCheck, accent: 'bg-violet-500', wash: 'bg-violet-500/10 text-violet-700' },
  benefit: { icon: HeartPulse, accent: 'bg-teal-500', wash: 'bg-teal-500/10 text-teal-700' },
  mortgage: { icon: House, accent: 'bg-amber-500', wash: 'bg-amber-500/10 text-amber-700' },
  credit_cards: { icon: CreditCard, accent: 'bg-orange-500', wash: 'bg-orange-500/10 text-orange-700' },
  other_assets: { icon: Gem, accent: 'bg-indigo-500', wash: 'bg-indigo-500/10 text-indigo-700' },
};

const FALLBACK_VISUAL = { icon: Landmark, accent: 'bg-slate-500', wash: 'bg-slate-500/10 text-slate-700' };

function aggregateMetricFromHash(hash: string): AggregateMetric | null {
  const match = hash.match(/^#finance\/details\/(net|assets|debt)$/);
  return (match?.[1] as AggregateMetric | undefined) ?? null;
}

function numericValue(value: FinanceValue) {
  return value?.ok && value.balance !== null ? value.balance : null;
}

function formatCurrency(value: number | null, precise = false, absolute = false) {
  if (value === null) return 'Not reported';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: precise ? 2 : 0,
    maximumFractionDigits: precise ? 2 : 0,
  }).format(absolute ? Math.abs(value) : value);
}

function FinanceAmount({ value }: { value: FinanceValue }) {
  if (!value) return <span aria-label="No observation">—</span>;
  if (!value.ok || value.balance === null) return <span>Unavailable</span>;
  return <span>{formatCurrency(value.balance, true)}</span>;
}

function titleCase(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatReportDate(value: string | null, compact = false) {
  if (!value) return 'No snapshots yet';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: compact ? 'short' : 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00Z`));
}

function observedAccounts(
  data: FinanceDashboardResponse,
  date: string | undefined,
  group?: string,
  kind?: 'asset' | 'debt',
) {
  if (!date) return new Set<string>();
  const ids = new Set<string>();
  for (const category of data.categories) {
    if (group && category.summaryGroup !== group) continue;
    if (kind && category.balanceKind !== kind) continue;
    const row = category.rows.find((item) => item.date === date);
    for (const account of category.accounts) {
      if (row?.values[account.id]) ids.add(account.id);
    }
  }
  return ids;
}

function aggregateGroupValue(data: FinanceDashboardResponse, date: string | undefined, group: string): FinanceValue {
  if (!date) return null;
  let found = false;
  let total = 0;
  for (const category of data.categories) {
    if (category.summaryGroup !== group) continue;
    const row = category.rows.find((item) => item.date === date);
    for (const account of category.accounts) {
      const value = row?.values[account.id] ?? null;
      if (!value) continue;
      found = true;
      if (!value.ok || value.balance === null) {
        return { balance: null, ok: false, errorType: value.errorType ?? 'incomplete data' };
      }
      total += category.balanceKind === 'debt' ? Math.abs(value.balance) : value.balance;
    }
  }
  return found ? { balance: total, ok: true, errorType: null } : null;
}

function aggregateKindValue(data: FinanceDashboardResponse, date: string | undefined, kind: 'asset' | 'debt') {
  if (!date) return null;
  let found = false;
  let total = 0;
  for (const category of data.categories) {
    if (category.balanceKind !== kind) continue;
    const row = category.rows.find((item) => item.date === date);
    for (const account of category.accounts) {
      const value = row?.values[account.id] ?? null;
      if (!value) continue;
      found = true;
      if (!value.ok || value.balance === null) return null;
      total += kind === 'debt' ? Math.abs(value.balance) : value.balance;
    }
  }
  return found ? total : null;
}

function Delta({ value, dark = false }: { value: number | null; dark?: boolean }) {
  if (value === null) return <span className={dark ? 'text-white/55' : 'text-muted-foreground'}>N/A</span>;
  const Icon = value >= 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 ${dark ? 'text-white/70' : 'text-muted-foreground'}`}>
      <Icon className="size-3" aria-hidden="true" /> {value >= 0 ? '+' : ''}{formatCurrency(value)}
    </span>
  );
}

function MetricCard({
  label,
  value,
  delta,
  primary = false,
  absolute = false,
  note,
  onExplore,
}: {
  label: string;
  value: number | null;
  delta: number | null;
  primary?: boolean;
  absolute?: boolean;
  note?: string;
  onExplore: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onExplore}
      className={primary
        ? 'relative col-span-2 overflow-hidden rounded-[1.35rem] bg-[linear-gradient(145deg,#17293c_0%,#22465a_100%)] p-4 text-left text-white shadow-[0_16px_35px_rgb(23_41_60/0.18)] transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5 lg:col-span-2'
        : 'rounded-[1.35rem] border border-border bg-card p-4 text-left shadow-[0_10px_28px_rgb(43_75_84/0.06)] transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5'}
    >
      {primary && <div className="pointer-events-none absolute -right-8 -top-10 size-40 rounded-full bg-white/7 blur-2xl" />}
      <p className={`text-[10px] font-semibold uppercase tracking-[0.13em] ${primary ? 'text-white/55' : 'text-muted-foreground'}`}>{label}</p>
      <p className="mt-2 font-heading text-[clamp(1.45rem,4vw,2.35rem)] font-semibold leading-none tracking-[-0.055em] tabular-nums">
        {formatCurrency(value, false, absolute)}
      </p>
      <p className="mt-3 text-[11px] sm:text-xs"><Delta value={delta} dark={primary} /></p>
      {note && <p className={`mt-1 text-[10px] ${primary ? 'text-white/45' : 'text-muted-foreground'}`}>{note}</p>}
      <span className="sr-only">Open details</span>
    </button>
  );
}

function CategoryCard({
  id,
  name,
  value,
  delta,
  kind,
  share,
  onExplore,
}: {
  id: string;
  name: string;
  value: number | null;
  delta: number | null;
  kind: 'asset' | 'debt';
  share: number;
  onExplore: () => void;
}) {
  const visual = GROUP_VISUALS[id] ?? FALLBACK_VISUAL;
  const Icon = visual.icon;
  return (
    <button type="button" onClick={onExplore} aria-label={`Open ${name} details`} className="group flex min-h-[108px] flex-col justify-between rounded-[1.15rem] border border-border bg-card p-3.5 text-left shadow-[0_8px_24px_rgb(43_75_84/0.045)] transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-[122px] sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <span className={`grid size-8 shrink-0 place-items-center rounded-xl ${visual.wash}`}><Icon className="size-4" aria-hidden="true" /></span>
        <span className="text-[9px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">{kind === 'debt' ? 'Amount owed' : `${Math.round(share)}% of assets`}</span>
      </div>
      <div className="mt-3 min-w-0">
        <p className="line-clamp-2 break-words text-xs font-medium leading-snug text-muted-foreground sm:text-sm">{name}</p>
        <div className="mt-1 flex items-end justify-between gap-2">
          <p className="truncate font-heading text-lg font-semibold tracking-[-0.04em] tabular-nums sm:text-xl">{formatCurrency(value, false, kind === 'debt')}</p>
          <span className="mb-0.5 shrink-0 text-[10px] font-medium text-muted-foreground">{delta === null ? 'N/A' : `${delta >= 0 ? '+' : ''}${formatCurrency(delta)}`}</span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full ${visual.accent}`} style={{ width: `${Math.max(value === null ? 0 : 4, Math.min(100, share))}%` }} />
        </div>
      </div>
    </button>
  );
}

function FinanceHeader({
  view,
  onViewChange,
  latestReportDate,
}: {
  view: FinanceView;
  onViewChange: (view: FinanceView) => void;
  latestReportDate: string | null;
}) {
  return (
    <div className="shrink-0 pb-3 sm:pb-4">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <WalletCards className="size-3.5" aria-hidden="true" /> Finance · Personal
          </div>
          <h1 className="mt-1 font-heading text-[clamp(1.35rem,4vw,2.05rem)] font-semibold tracking-[-0.05em]">{view === 'overview' ? 'Current position' : 'Details'}</h1>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Report date</p>
          <p className="mt-0.5 text-xs font-medium sm:text-sm">{formatReportDate(latestReportDate, true)}</p>
        </div>
      </div>
      <div className="mt-3 inline-flex rounded-xl bg-muted p-1" aria-label="Finance views">
        <Button type="button" size="sm" variant={view === 'overview' ? 'default' : 'ghost'} aria-pressed={view === 'overview'} onClick={() => onViewChange('overview')} className="min-h-11 rounded-lg px-3 sm:min-h-8">
          <LayoutDashboard aria-hidden="true" /> Overview
        </Button>
        <Button type="button" size="sm" variant={view === 'history' ? 'default' : 'ghost'} aria-pressed={view === 'history'} onClick={() => onViewChange('history')} className="min-h-11 rounded-lg px-3 sm:min-h-8">
          <History aria-hidden="true" /> Details
        </Button>
      </div>
    </div>
  );
}

function Overview({
  data,
  onExplore,
}: {
  data: FinanceDashboardResponse;
  onExplore: (group: string, metric?: AggregateMetric) => void;
}) {
  const [comparisonPeriod, setComparisonPeriod] = useState<ComparisonPeriod>('dd');
  const latest = data.summary.rows.at(-1) ?? null;
  const kindByGroup = new Map(data.categories.map((category) => [category.summaryGroup, category.balanceKind]));
  const latestAccounts = observedAccounts(data, latest?.date);
  const baselineDate = firstComparisonDate(
    data.dates,
    latest?.date,
    comparisonPeriod,
    (date) => valueForGroup(data, data.summary.rows.find((row) => row.date === date), 'all') !== null,
  );
  const baselineAssetDate = firstComparisonDate(
    data.dates,
    latest?.date,
    comparisonPeriod,
    (date) => aggregateKindValue(data, date, 'asset') !== null,
  );
  const baselineDebtDate = firstComparisonDate(
    data.dates,
    latest?.date,
    comparisonPeriod,
    (date) => aggregateKindValue(data, date, 'debt') !== null,
  );

  const groups = data.summary.columns.map((column) => {
    const groupBaselineDate = firstComparisonDate(
      data.dates,
      latest?.date,
      comparisonPeriod,
      (date) => numericValue(aggregateGroupValue(data, date, column.id)) !== null,
    );
    const value = numericValue(aggregateGroupValue(data, latest?.date, column.id));
    const baselineValue = numericValue(aggregateGroupValue(data, groupBaselineDate ?? undefined, column.id));
    const kind = kindByGroup.get(column.id) ?? 'asset';
    return {
      ...column,
      kind,
      value,
      baselineValue,
      delta: groupBaselineDate !== null && value !== null && baselineValue !== null
        ? value - baselineValue
        : null,
    } as const;
  });

  const assets = aggregateKindValue(data, latest?.date, 'asset');
  const debtOwed = aggregateKindValue(data, latest?.date, 'debt');
  const baselineAssets = aggregateKindValue(data, baselineAssetDate ?? undefined, 'asset');
  const baselineDebtOwed = aggregateKindValue(data, baselineDebtDate ?? undefined, 'debt');
  const baselineRow = data.summary.rows.find((row) => row.date === baselineDate);
  const trackedBalance = valueForGroup(data, latest ?? undefined, 'all');
  const baselineTrackedBalance = valueForGroup(data, baselineRow, 'all');

  return (
    <div className="pb-[max(0.75rem,env(safe-area-inset-bottom))] pr-0.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-y-contain [scrollbar-width:thin]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Difference</p>
        <div className="inline-flex rounded-xl bg-muted p-1" aria-label="Balance comparison period">
          {COMPARISON_PERIODS.map((period) => (
            <button
              key={period.id}
              type="button"
              aria-pressed={comparisonPeriod === period.id}
              onClick={() => setComparisonPeriod(period.id)}
              className={`min-h-11 rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 ${comparisonPeriod === period.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {period.label}
            </button>
          ))}
        </div>
      </div>
      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3" aria-label="Latest tracked totals">
        <MetricCard
          label="Tracked balance"
          value={trackedBalance}
          delta={baselineDate !== null && trackedBalance !== null && baselineTrackedBalance !== null ? trackedBalance - baselineTrackedBalance : null}
          primary
          note="Recorded assets less recorded liabilities; not a net-worth estimate."
          onExplore={() => onExplore('all', 'net')}
        />
        <MetricCard label="Tracked assets" value={assets} delta={baselineAssetDate !== null && assets !== null && baselineAssets !== null ? assets - baselineAssets : null} onExplore={() => onExplore('all', 'assets')} />
        <MetricCard label="Debt owed" value={debtOwed} delta={baselineDebtDate !== null && debtOwed !== null && baselineDebtOwed !== null ? debtOwed - baselineDebtOwed : null} onExplore={() => onExplore('all', 'debt')} />
      </section>

      <div className="mb-2 mt-4 flex items-end justify-between gap-3 sm:mt-5">
        <div>
          <h2 className="font-heading text-sm font-semibold tracking-[-0.02em] sm:text-base">Category breakdown</h2>
          <p className="mt-0.5 text-[10px] text-muted-foreground sm:text-xs">{groups.some((group) => group.value === null) ? 'An unavailable category is withheld from aggregate totals.' : `${latestAccounts.size} accounts reported.`}</p>
        </div>
        <p className="hidden text-[10px] text-muted-foreground sm:block">Exact cents remain available in Details</p>
      </div>

      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3" aria-label="Latest balances by category">
        {groups.map((group) => {
          const denominator = group.kind === 'debt' ? (debtOwed ?? 0) : (assets ?? 0);
          const share = group.value === null || denominator === 0 ? 0 : Math.abs(group.value) / denominator * 100;
          return (
            <CategoryCard
              key={group.id}
              id={group.id}
              name={titleCase(group.name)}
              value={group.value}
              delta={group.delta}
              kind={group.kind}
              share={share}
              onExplore={() => onExplore(group.id)}
            />
          );
        })}
      </section>
    </div>
  );
}

type HistoryAccount = FinanceAccount & {
  categoryName: string;
  balanceKind: 'asset' | 'debt';
  summaryGroup: string;
};

type HistoryPoint = {
  key: string;
  label: string;
  date: string | null;
  value: number | null;
  reported: boolean;
  coverageKey: string | null;
  coverageBreak: boolean;
};

const HISTORY_PAGE_SIZES = [5, 10, 20];
const HISTORY_RANGE_OPTIONS: Array<{
  id: HistoryRangePreset;
  label: string;
  compactLabel: string;
}> = [
  { id: '30d', label: 'Last 30 days', compactLabel: '30D' },
  { id: '90d', label: 'Last 90 days', compactLabel: '90D' },
  { id: '1y', label: 'Last 1 year', compactLabel: '1Y' },
  { id: 'all', label: 'All dates', compactLabel: 'All' },
  { id: 'custom', label: 'Custom', compactLabel: 'Custom' },
];
const MOBILE_HISTORY_QUERY = '(max-width: 767px)';

function subscribeToMobileHistory(listener: () => void) {
  const query = window.matchMedia(MOBILE_HISTORY_QUERY);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

function mobileHistorySnapshot() {
  return window.matchMedia(MOBILE_HISTORY_QUERY).matches;
}

function valueForGroup(data: FinanceDashboardResponse, row: FinanceRow | undefined, group: string) {
  if (!row) return null;
  if (group !== 'all') return numericValue(aggregateGroupValue(data, row.date, group));
  const kindByGroup = new Map(data.categories.map((category) => [category.summaryGroup, category.balanceKind]));
  let found = false;
  let total = 0;
  for (const column of data.summary.columns) {
    const value = aggregateGroupValue(data, row.date, column.id);
    if (!value) continue;
    found = true;
    if (!value.ok || value.balance === null) return null;
    total += kindByGroup.get(column.id) === 'debt' ? -Math.abs(value.balance) : value.balance;
  }
  return found ? total : null;
}

function historyAccounts(data: FinanceDashboardResponse, group: string) {
  const accounts = new Map<string, HistoryAccount>();
  for (const category of data.categories.filter((item) => item.summaryGroup === group)) {
    for (const account of category.accounts) {
      const existing = accounts.get(account.id);
      if (existing) {
        if (!existing.categoryName.split(' / ').includes(category.name)) {
          existing.categoryName = `${existing.categoryName} / ${category.name}`;
        }
        continue;
      }
      accounts.set(account.id, {
        ...account,
        categoryName: category.name,
        balanceKind: category.balanceKind,
        summaryGroup: category.summaryGroup,
      });
    }
  }
  return Array.from(accounts.values());
}

function accountValue(data: FinanceDashboardResponse, account: HistoryAccount, date: string) {
  for (const category of data.categories) {
    if (category.summaryGroup !== account.summaryGroup) continue;
    const value = category.rows.find((row) => row.date === date)?.values[account.id] ?? null;
    if (value) return value;
  }
  return null;
}

function accountMeta(account: HistoryAccount) {
  return [account.institution, account.categoryName, account.lastFour ? `••${account.lastFour}` : null]
    .filter(Boolean)
    .join(' · ');
}

function trendValue(
  data: FinanceDashboardResponse,
  row: FinanceRow | undefined,
  group: string,
  metric: HistoryTrendMetric,
) {
  if (!row) return null;
  if (metric === 'assets') return aggregateKindValue(data, row.date, 'asset');
  if (metric === 'debt') return aggregateKindValue(data, row.date, 'debt');
  if (metric === 'net') return valueForGroup(data, row, 'all');
  return valueForGroup(data, row, group);
}

function trendHasObservation(
  data: FinanceDashboardResponse,
  date: string,
  group: string,
  metric: HistoryTrendMetric,
) {
  if (metric === 'assets') return observedAccounts(data, date, undefined, 'asset').size > 0;
  if (metric === 'debt') return observedAccounts(data, date, undefined, 'debt').size > 0;
  if (metric === 'net') return observedAccounts(data, date).size > 0;
  return observedAccounts(data, date, group).size > 0;
}

function coverageSignature(
  data: FinanceDashboardResponse,
  date: string,
  group: string,
  metric: HistoryTrendMetric,
) {
  const entries = new Set<string>();
  for (const category of data.categories) {
    if (metric === 'assets' && category.balanceKind !== 'asset') continue;
    if (metric === 'debt' && category.balanceKind !== 'debt') continue;
    if (metric === 'group' && category.summaryGroup !== group) continue;
    const row = category.rows.find((item) => item.date === date);
    for (const account of category.accounts) {
      if (row?.values[account.id]) entries.add(`${account.id}:${category.balanceKind}`);
    }
  }
  return Array.from(entries).sort().join('|');
}

function historyPeriodKey(date: string, cadence: ChartCadence) {
  if (cadence === 'daily') return date;
  return cadence === 'monthly' ? date.slice(0, 7) : date.slice(0, 4);
}

function historyPeriodLabel(key: string, cadence: ChartCadence) {
  if (cadence === 'annual') return key;
  const date = new Date(`${key}${cadence === 'monthly' ? '-01' : ''}T00:00:00Z`);
  if (cadence === 'daily') {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(date);
    return `${day} ’${key.slice(2, 4)}`;
  }
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' }).format(date);
}

function buildPeriodSeries(
  data: FinanceDashboardResponse,
  group: string,
  metric: HistoryTrendMetric,
  dates: string[],
  cadence: ChartCadence,
  from: string,
  to: string,
) {
  if (!from || !to || from > to) return [];
  const reportByPeriod = new Map(
    firstHistoryDates(
      dates,
      cadence,
      (date) => trendHasObservation(data, date, group, metric),
    ).map((date) => [historyPeriodKey(date, cadence), date]),
  );

  const startSource = new Date(`${from}T00:00:00Z`);
  const endSource = new Date(`${to}T00:00:00Z`);
  const start = cadence === 'daily'
    ? startSource
    : cadence === 'monthly'
      ? new Date(Date.UTC(startSource.getUTCFullYear(), startSource.getUTCMonth(), 1))
      : new Date(Date.UTC(startSource.getUTCFullYear(), 0, 1));
  const end = cadence === 'daily'
    ? endSource
    : cadence === 'monthly'
      ? new Date(Date.UTC(endSource.getUTCFullYear(), endSource.getUTCMonth(), 1))
      : new Date(Date.UTC(endSource.getUTCFullYear(), 0, 1));
  const points: HistoryPoint[] = [];
  for (const cursor = new Date(start); cursor <= end;) {
    const key = cadence === 'daily'
      ? cursor.toISOString().slice(0, 10)
      : cadence === 'monthly'
        ? `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`
        : String(cursor.getUTCFullYear());
    const date = reportByPeriod.get(key) ?? null;
    const row = date ? data.summary.rows.find((item) => item.date === date) : undefined;
    const value = trendValue(data, row, group, metric);
    points.push({
      key,
      label: historyPeriodLabel(key, cadence),
      date,
      value,
      reported: date !== null,
      coverageKey: date ? coverageSignature(data, date, group, metric) : null,
      coverageBreak: false,
    });
    if (cadence === 'daily') cursor.setUTCDate(cursor.getUTCDate() + 1);
    else if (cadence === 'monthly') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
  }
  let previousCoverage: string | null = null;
  return points.map((point) => {
    const hasCoverage = point.reported && Boolean(point.coverageKey);
    const coverageBreak = hasCoverage && previousCoverage !== null && previousCoverage !== point.coverageKey;
    if (hasCoverage) previousCoverage = point.coverageKey;
    return { ...point, coverageBreak };
  });
}

function compactCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function HistoryTrend({
  data,
  selectedGroup,
  selectedName,
  metric,
  dates,
  from,
  to,
  cadence,
  onCadenceChange,
  anchorId,
  showIntervalControl = true,
}: {
  data: FinanceDashboardResponse;
  selectedGroup: string;
  selectedName: string;
  metric: HistoryTrendMetric;
  dates: string[];
  from: string;
  to: string;
  cadence: ChartCadence;
  onCadenceChange: (cadence: ChartCadence) => void;
  anchorId?: string;
  showIntervalControl?: boolean;
}) {
  const instanceId = useId().replaceAll(':', '');
  const titleId = `history-trend-title-${instanceId}`;
  const fillId = `finance-history-fill-${instanceId}`;
  const series = useMemo(
    () => buildPeriodSeries(data, selectedGroup, metric, dates, cadence, from, to),
    [data, selectedGroup, metric, dates, cadence, from, to],
  );
  const relevantDates = useMemo(
    () => dates.filter((date) => trendHasObservation(data, date, selectedGroup, metric)),
    [data, dates, metric, selectedGroup],
  );
  const latestDate = relevantDates.at(-1) ?? null;
  const latestRow = latestDate ? data.summary.rows.find((row) => row.date === latestDate) : undefined;
  const latestValue = trendValue(data, latestRow, selectedGroup, metric);
  const gapCount = series.filter((point) => !point.reported).length;
  const coverageBreakCount = series.filter((point) => point.coverageBreak).length;
  const unavailableCount = series.filter((point) => point.reported && point.value === null).length;
  const reportCount = series.length - gapCount;
  const plottedCount = series.filter((point) => point.value !== null).length;
  const missingValueCount = series.length - plottedCount;
  const trendColor = metric === 'assets' ? '#347b63' : metric === 'debt' ? '#a6634c' : '#2e7484';
  const chartConfig = {
    value: { label: selectedName, color: trendColor },
  } satisfies ChartConfig;
  const unit = cadence === 'daily' ? 'day' : cadence === 'monthly' ? 'month' : 'year';
  const cadenceDescription = cadence === 'daily' ? 'Reported balance by day' : `First available balance in each ${unit}`;

  return (
    <section id={anchorId} tabIndex={-1} className="scroll-mt-3 rounded-[1.25rem] border border-border bg-card p-4 shadow-[0_10px_30px_rgb(43_75_84/0.06)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:p-5" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-xl bg-primary/10 text-primary"><ChartNoAxesCombined className="size-4" aria-hidden="true" /></span>
            <div>
              <h2 id={titleId} className="font-heading text-sm font-semibold sm:text-base">{selectedName} over time</h2>
              <p className="text-[10px] text-muted-foreground sm:text-xs">{cadenceDescription}</p>
            </div>
          </div>
        </div>
        <div className="text-right">
          <p className="font-heading text-xl font-semibold tracking-[-0.04em] tabular-nums sm:text-2xl">{latestValue === null ? 'N/A' : formatCurrency(latestValue)}</p>
          <p className="mt-1 text-[10px] text-muted-foreground sm:text-xs">{latestDate ? `As of ${formatReportDate(latestDate, true)}` : 'No reports in range'}</p>
        </div>
      </div>

      {showIntervalControl ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">Chart interval{selectedGroup === 'all' ? ' · all charts' : ''}</p>
          <div className="inline-flex rounded-xl bg-muted p-1" aria-label="Chart interval">
            {(['daily', 'monthly', 'annual'] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={cadence === item}
                onClick={() => onCadenceChange(item)}
                className={`min-h-11 rounded-lg px-3 text-xs font-semibold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 ${cadence === item ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {item === 'daily' ? 'Daily' : item === 'monthly' ? 'Monthly' : 'Annual'}
              </button>
            ))}
          </div>
        </div>
      ) : <div className="mt-3 border-t border-border" />}

      {plottedCount > 0 ? (
        <ChartContainer config={chartConfig} className="mt-2 h-[180px] w-full aspect-auto sm:h-[210px]" aria-label={`${selectedName} ${cadence} balance history`}>
          <AreaChart
            data={series}
            accessibilityLayer
            title={`${selectedName} ${cadence} balance history`}
            desc={`${plottedCount} valid ${plottedCount === 1 ? 'value' : 'values'} across ${series.length} periods. ${missingValueCount} ${missingValueCount === 1 ? 'period has' : 'periods have'} no usable value. Solid dots mark valid data; the line connects adjacent valid values across missing periods.`}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-value)" stopOpacity={0.28} />
                <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 5" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={28} />
            <YAxis tickLine={false} axisLine={false} width={54} tickFormatter={compactCurrency} />
            <ChartTooltip
              cursor={{ stroke: 'var(--border)' }}
              content={({ active, payload }) => {
                const point = payload?.find((item) => item.value !== null && item.value !== undefined)?.payload as HistoryPoint | undefined;
                if (!active || !point || point.value === null) return null;
                return (
                  <div className="min-w-40 rounded-xl border border-border bg-popover px-3 py-2 text-popover-foreground shadow-xl">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{point.label}</p>
                    <p className="mt-1 font-mono text-sm font-semibold tabular-nums">{formatCurrency(point.value, true)}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">As of {formatReportDate(point.date, true)}</p>
                  </div>
                );
              }}
            />
            <Area
              dataKey="value"
              name={selectedName}
              type="linear"
              stroke="var(--color-value)"
              strokeWidth={2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill={`url(#${fillId})`}
              connectNulls
              dot={{ r: 2.75, fill: 'var(--color-value)', stroke: 'var(--color-value)', strokeWidth: 0 }}
              activeDot={{ r: 4, fill: 'var(--color-value)', stroke: 'var(--color-value)', strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      ) : (
        <div className="mt-2 grid h-[180px] place-items-center rounded-xl bg-muted/45 px-6 text-center sm:h-[210px]">
          <div>
            <CalendarRange className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium">No reported balance in this range</p>
            <p className="mt-1 text-xs text-muted-foreground">Adjust the dates or choose another category.</p>
          </div>
        </div>
      )}
      <div className="mt-1 flex items-center justify-between gap-4 text-[10px] text-muted-foreground sm:text-xs">
        <p>{plottedCount === 0
          ? (reportCount === 0 ? 'No reports in the selected period.' : 'No usable balance in the selected period.')
          : (missingValueCount === 0 ? `Every ${unit} has a valid value.` : `${missingValueCount} ${missingValueCount === 1 ? unit : `${unit}s`} ${missingValueCount === 1 ? 'has' : 'have'} no usable value; the line bridges between adjacent valid dots.`)}</p>
        <div className="flex items-center gap-3">
          {coverageBreakCount > 0 && <p>{coverageBreakCount} coverage {coverageBreakCount === 1 ? 'change' : 'changes'}</p>}
          {unavailableCount > 0 && <p>{unavailableCount} unavailable</p>}
        </div>
      </div>
    </section>
  );
}

function HistoryTable({
  data,
  selectedGroup,
  selectedName,
  dates,
}: {
  data: FinanceDashboardResponse;
  selectedGroup: string;
  selectedName: string;
  dates: string[];
}) {
  const accounts = historyAccounts(data, selectedGroup);

  return (
    <section className="hidden overflow-x-auto rounded-[1.2rem] border border-border bg-card shadow-[0_10px_30px_rgb(43_75_84/0.055)] [&>[data-slot=table-container]]:overflow-visible md:block" aria-label={`${selectedName} reporting table. Scroll horizontally for more accounts.`}>
      <Table className="min-w-[760px] border-separate border-spacing-0 text-[13px]">
        <caption className="sr-only">{selectedName} balances by reporting date, newest first.</caption>
        <TableHeader className="bg-card/95">
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className="sticky left-0 z-20 w-32 min-w-32 border-b border-r bg-card px-4 font-semibold">Report date</TableHead>
            {selectedGroup === 'all'
              ? data.summary.columns.map((column) => <TableHead scope="col" key={column.id} className="min-w-40 border-b px-4 text-right font-semibold">{titleCase(column.name)}</TableHead>)
              : accounts.map((account) => (
                <TableHead scope="col" key={account.id} className="h-auto min-w-48 max-w-56 border-b px-4 py-3 align-bottom whitespace-normal">
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{accountMeta(account)}</span>
                  <span className="mt-1 block text-sm font-medium leading-tight text-foreground">{account.account}</span>
                </TableHead>
              ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {dates.map((date) => {
            return (
              <TableRow key={date} className="hover:bg-muted/35">
                <th scope="row" className="sticky left-0 z-10 border-r bg-card px-4 py-3 text-left font-mono text-xs font-normal text-muted-foreground">{formatReportDate(date, true)}</th>
                {selectedGroup === 'all'
                  ? data.summary.columns.map((column) => {
                    const value = aggregateGroupValue(data, date, column.id);
                    return <TableCell key={column.id} className={`px-4 text-right font-mono tabular-nums ${value && !value.ok ? 'text-destructive' : !value ? 'text-muted-foreground' : ''}`}><FinanceAmount value={value} /></TableCell>;
                  })
                  : accounts.map((account) => {
                    const value = accountValue(data, account, date);
                    const displayValue = value?.ok && value.balance !== null && account.balanceKind === 'debt' ? { ...value, balance: Math.abs(value.balance) } : value;
                    return <TableCell key={account.id} className={`px-4 text-right font-mono tabular-nums ${value && !value.ok ? 'text-destructive' : !value ? 'text-muted-foreground' : ''}`}><FinanceAmount value={displayValue} /></TableCell>;
                  })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}

function MobileHistoryList({
  data,
  selectedGroup,
  dates,
}: {
  data: FinanceDashboardResponse;
  selectedGroup: string;
  dates: string[];
}) {
  const accounts = historyAccounts(data, selectedGroup);

  return (
    <div className="space-y-2.5 md:hidden">
      {dates.map((date) => {
        return (
          <article key={date} className="rounded-[1.1rem] border border-border bg-card p-4 shadow-[0_8px_24px_rgb(43_75_84/0.05)]">
            <div className="mb-3 flex items-center gap-2 border-b border-border pb-2.5">
              <CalendarRange className="size-4 text-primary" aria-hidden="true" />
              <h3 className="font-heading text-sm font-semibold">{formatReportDate(date, true)}</h3>
            </div>
            <dl className="space-y-2.5">
              {selectedGroup === 'all'
                ? data.summary.columns.map((column) => {
                  const value = aggregateGroupValue(data, date, column.id);
                  return (
                    <div key={column.id} className="flex items-center justify-between gap-4">
                      <dt className="min-w-0 text-xs text-muted-foreground">{titleCase(column.name)}</dt>
                      <dd className={`shrink-0 font-mono text-xs font-medium tabular-nums ${value && !value.ok ? 'text-destructive' : ''}`}><FinanceAmount value={value} /></dd>
                    </div>
                  );
                })
                : accounts.map((account) => {
                  const value = accountValue(data, account, date);
                  const displayValue = value?.ok && value.balance !== null && account.balanceKind === 'debt' ? { ...value, balance: Math.abs(value.balance) } : value;
                  return (
                    <div key={account.id} className="flex items-start justify-between gap-4">
                      <dt className="min-w-0">
                        <span className="block break-words text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{accountMeta(account)}</span>
                        <span className="mt-0.5 block break-words text-xs leading-snug">{account.account}</span>
                      </dt>
                      <dd className={`shrink-0 pt-0.5 font-mono text-xs font-medium tabular-nums ${value && !value.ok ? 'text-destructive' : ''}`}><FinanceAmount value={displayValue} /></dd>
                    </div>
                  );
                })}
            </dl>
          </article>
        );
      })}
    </div>
  );
}

function HistoryWorkspace({
  data,
  selectedGroup,
  onSelectedGroupChange,
  focusMetric,
  onFocusHandled,
}: {
  data: FinanceDashboardResponse;
  selectedGroup: string;
  onSelectedGroupChange: (group: string) => void;
  focusMetric: AggregateMetric | null;
  onFocusHandled: () => void;
}) {
  const [page, setPage] = useState(0);
  const [pageSizeOverride, setPageSizeOverride] = useState<number | null>(null);
  const [cadence, setCadence] = useState<ChartCadence>('daily');
  const [rangePreset, setRangePreset] = useState<HistoryRangePreset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const isMobile = useSyncExternalStore(subscribeToMobileHistory, mobileHistorySnapshot, () => false);
  const pageSize = pageSizeOverride ?? (isMobile ? 5 : 10);
  const selectedColumn = data.summary.columns.find((column) => column.id === selectedGroup);
  const safeGroup = selectedGroup === 'all' || selectedColumn ? selectedGroup : 'all';
  const selectedName = safeGroup === 'all' ? 'All balances' : titleCase(selectedColumn?.name ?? safeGroup);
  const { from: minDate, to: maxDate } = historyDateRange(data.dates, 'all');
  const { from, to } = historyDateRange(data.dates, rangePreset, { from: customFrom, to: customTo });
  const filteredDates = useMemo(
    () => data.dates.filter((date) => date >= from && date <= to),
    [data.dates, from, to],
  );
  const snapshotDates = useMemo(
    () => cadence === 'daily'
      ? filteredDates
      : firstHistoryDates(
        filteredDates,
        cadence,
        (date) => safeGroup === 'all' || observedAccounts(data, date, safeGroup).size > 0,
      ),
    [cadence, data, filteredDates, safeGroup],
  );
  const descendingDates = useMemo(() => [...snapshotDates].sort((left, right) => right.localeCompare(left)), [snapshotDates]);
  const pageCount = Math.ceil(descendingDates.length / pageSize);
  const safePage = pageCount === 0 ? 0 : Math.min(page, pageCount - 1);
  const firstIndex = safePage * pageSize;
  const visibleDates = descendingDates.slice(firstIndex, firstIndex + pageSize);
  const draftRangeInvalid = Boolean(
    draftFrom
    && draftTo
    && (draftFrom > draftTo || draftFrom < minDate || draftTo > maxDate),
  );
  const snapshotDescription = cadence === 'daily'
    ? 'Exact balances, newest first'
    : `First available snapshot in each ${cadence === 'monthly' ? 'month' : 'year'}, newest first`;

  useEffect(() => {
    if (safeGroup !== 'all' || !focusMetric) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`finance-trend-${focusMetric}`);
      if (target instanceof HTMLElement) {
        target.focus({ preventScroll: true });
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const behavior = reducedMotion ? 'auto' : 'smooth';
        const targetRect = target.getBoundingClientRect();
        const scrollContainer = document.getElementById('finance-history-scroll');
        if (window.matchMedia('(min-width: 1024px)').matches && scrollContainer) {
          const containerRect = scrollContainer.getBoundingClientRect();
          scrollContainer.scrollTo({
            behavior,
            top: Math.max(0, scrollContainer.scrollTop + targetRect.top - containerRect.top - 12),
          });
        } else {
          window.scrollTo({
            behavior,
            top: Math.max(0, window.scrollY + targetRect.top - 12),
          });
        }
      }
      onFocusHandled();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusMetric, onFocusHandled, safeGroup]);

  function changeGroup(group: string | null) {
    if (!group) return;
    onFocusHandled();
    onSelectedGroupChange(group);
    window.history.replaceState(null, '', '#finance/details');
    setPage(0);
  }

  function changePageSize(value: string | null) {
    if (!value) return;
    setPageSizeOverride(Number(value));
    setPage(0);
  }

  function changeCadence(nextCadence: ChartCadence) {
    if (nextCadence === cadence) return;
    setCadence(nextCadence);
    setRangePreset(defaultHistoryRange(nextCadence));
    setPage(0);
  }

  function changeRangePreset(nextPreset: HistoryRangePreset | null) {
    if (!nextPreset) return;
    if (nextPreset === 'custom') {
      setDraftFrom(from);
      setDraftTo(to);
      setCustomFrom(from);
      setCustomTo(to);
    }
    setRangePreset(nextPreset);
    setPage(0);
  }

  function applyRange(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftFrom || !draftTo || draftRangeInvalid) return;
    setCustomFrom(draftFrom);
    setCustomTo(draftTo);
    setPage(0);
  }

  return (
    <div id="finance-history-scroll" className="pb-[max(0.75rem,env(safe-area-inset-bottom))] pr-0.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-y-contain [scrollbar-width:thin]">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <label htmlFor="history-category" className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Category</label>
          <Select value={safeGroup} onValueChange={changeGroup}>
            <SelectTrigger id="history-category" className="h-11 min-w-52 rounded-xl bg-card px-3">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value="all">All balances</SelectItem>
              {data.summary.columns.map((column) => <SelectItem key={column.id} value={column.id}>{titleCase(column.name)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-end lg:ml-auto lg:w-auto lg:flex-nowrap">
          <div className="min-w-0">
            <span id="history-date-range-label" className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Date range</span>
            <ToggleGroup
              value={[rangePreset]}
              onValueChange={(values) => changeRangePreset((values[0] as HistoryRangePreset | undefined) ?? null)}
              aria-labelledby="history-date-range-label"
              spacing={1}
              className="grid h-11 w-full grid-cols-5 rounded-xl bg-muted p-1 sm:flex sm:w-fit"
            >
              {HISTORY_RANGE_OPTIONS.map((option) => (
                <ToggleGroupItem
                  key={option.id}
                  value={option.id}
                  aria-label={option.label}
                  className="h-9 min-w-0 px-2 text-[11px] font-semibold text-muted-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm sm:min-w-[5.25rem] sm:text-xs"
                >
                  <span className="sm:hidden">{option.compactLabel}</span>
                  <span className="hidden sm:inline">{option.label}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {rangePreset === 'custom' && (
            <div className="min-w-0">
              <form id="history-custom-date-range" aria-label="Custom date range" onSubmit={applyRange} className="flex w-full flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-1.5 shadow-[0_8px_24px_rgb(43_75_84/0.05)] sm:w-auto">
                <label htmlFor="history-date-from" className="min-w-[7.5rem] flex-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  From
                  <Input id="history-date-from" type="date" required min={minDate} max={draftTo || maxDate} value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} aria-invalid={draftRangeInvalid || undefined} aria-describedby={draftRangeInvalid ? 'history-date-range-error' : undefined} className="mt-1 h-11 bg-background text-sm normal-case tracking-normal text-foreground" />
                </label>
                <label htmlFor="history-date-to" className="min-w-[7.5rem] flex-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  To
                  <Input id="history-date-to" type="date" required min={draftFrom || minDate} max={maxDate} value={draftTo} onChange={(event) => setDraftTo(event.target.value)} aria-invalid={draftRangeInvalid || undefined} aria-describedby={draftRangeInvalid ? 'history-date-range-error' : undefined} className="mt-1 h-11 bg-background text-sm normal-case tracking-normal text-foreground" />
                </label>
                <Button type="submit" disabled={draftRangeInvalid || !draftFrom || !draftTo} className="min-h-11 px-4">Apply</Button>
              </form>
              {draftRangeInvalid && <p id="history-date-range-error" role="alert" className="mt-1.5 text-xs text-destructive">Choose a valid range within the available report dates.</p>}
            </div>
          )}
        </div>
      </div>

      {safeGroup === 'all' ? (
        <div className="space-y-3">
          <HistoryTrend
            data={data}
            selectedGroup="all"
            selectedName="Net balance"
            metric="net"
            dates={filteredDates}
            from={from}
            to={to}
            cadence={cadence}
            onCadenceChange={changeCadence}
            anchorId="finance-trend-net"
          />
          <div className="grid gap-3 lg:grid-cols-2">
            <HistoryTrend
              data={data}
              selectedGroup="all"
              selectedName="Tracked assets"
              metric="assets"
              dates={filteredDates}
              from={from}
              to={to}
              cadence={cadence}
              onCadenceChange={changeCadence}
              anchorId="finance-trend-assets"
              showIntervalControl={false}
            />
            <HistoryTrend
              data={data}
              selectedGroup="all"
              selectedName="Debt owed"
              metric="debt"
              dates={filteredDates}
              from={from}
              to={to}
              cadence={cadence}
              onCadenceChange={changeCadence}
              anchorId="finance-trend-debt"
              showIntervalControl={false}
            />
          </div>
        </div>
      ) : (
        <HistoryTrend
          data={data}
          selectedGroup={safeGroup}
          selectedName={selectedName}
          metric="group"
          dates={filteredDates}
          from={from}
          to={to}
          cadence={cadence}
          onCadenceChange={changeCadence}
        />
      )}

      <div className="mb-2 mt-4 flex items-center justify-between gap-4 sm:mt-5">
        <div>
          <h2 className="font-heading text-sm font-semibold sm:text-base">Reported snapshots</h2>
          <p className="text-[10px] text-muted-foreground sm:text-xs">{snapshotDescription}</p>
        </div>
        <p aria-live="polite" className="text-[10px] text-muted-foreground sm:text-xs">{descendingDates.length === 0 ? '0 reports' : `${firstIndex + 1}–${Math.min(firstIndex + pageSize, descendingDates.length)} of ${descendingDates.length}`}</p>
      </div>

      {visibleDates.length > 0 ? (
        <>
          <HistoryTable data={data} selectedGroup={safeGroup} selectedName={selectedName} dates={visibleDates} />
          <MobileHistoryList data={data} selectedGroup={safeGroup} dates={visibleDates} />
        </>
      ) : (
        <section className="grid min-h-40 place-items-center rounded-[1.2rem] border border-dashed border-border bg-card/55 px-6 text-center" aria-label="No snapshots in selected range">
          <div>
            <CalendarRange className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium">No snapshots in this range</p>
            <p className="mt-1 text-xs text-muted-foreground">Choose a wider date range to see reported balances.</p>
          </div>
        </section>
      )}

      {descendingDates.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/60 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground sm:text-xs">Reports per page</span>
            <Select value={String(pageSize)} onValueChange={changePageSize}>
              <SelectTrigger aria-label="Reports per page" size="sm" className="min-h-11 w-16 bg-card sm:min-h-9"><SelectValue /></SelectTrigger>
              <SelectContent align="start">
                {HISTORY_PAGE_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))} className="min-h-11 rounded-lg sm:min-h-9"><ChevronLeft aria-hidden="true" /> Newer</Button>
            <span className="min-w-16 text-center text-[10px] text-muted-foreground sm:text-xs">{safePage + 1} / {pageCount}</span>
            <Button type="button" variant="outline" size="sm" disabled={safePage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} className="min-h-11 rounded-lg sm:min-h-9">Older <ChevronRight aria-hidden="true" /></Button>
          </div>
        </div>
      )}
      <p className="pt-2 text-[10px] text-muted-foreground">Solid dots mark valid reported values. The line connects adjacent valid dots across missing or unavailable periods.</p>
    </div>
  );
}

export function FinanceDashboard({ refreshToken }: { refreshToken: number }) {
  const [data, setData] = useState<FinanceDashboardResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [view, setView] = useState<FinanceView>('overview');
  const [selectedGroup, setSelectedGroup] = useState('all');
  const [focusMetric, setFocusMetric] = useState<AggregateMetric | null>(null);
  const clearFocusMetric = useCallback(() => setFocusMetric(null), []);

  useEffect(() => {
    const syncView = () => {
      const metric = aggregateMetricFromHash(window.location.hash);
      const detailsView = window.location.hash === '#finance/details'
        || window.location.hash === '#finance/history'
        || metric !== null;
      setView(detailsView ? 'history' : 'overview');
      setFocusMetric(metric);
      if (metric) setSelectedGroup('all');
      if (window.location.hash === '#finance/history') {
        window.history.replaceState(null, '', '#finance/details');
      }
    };
    syncView();
    window.addEventListener('hashchange', syncView);
    return () => window.removeEventListener('hashchange', syncView);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => setStatus('loading'));
    fetch('/api/finance/snapshots', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Finance data is unavailable');
        return response.json() as Promise<FinanceDashboardResponse>;
      })
      .then((nextData) => {
        setData(nextData);
        setStatus('ready');
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setStatus('error');
      });
    return () => controller.abort();
  }, [refreshToken]);

  function changeView(nextView: FinanceView, metric?: AggregateMetric) {
    setView(nextView);
    if (nextView === 'overview') setFocusMetric(null);
    const nextHash = nextView === 'overview'
      ? '#finance'
      : metric
        ? `#finance/details/${metric}`
        : '#finance/details';
    window.history.replaceState(null, '', nextHash);
  }

  function exploreGroup(group: string, metric?: AggregateMetric) {
    setSelectedGroup(group);
    setFocusMetric(metric ?? null);
    changeView('history', metric);
  }

  if (status === 'loading' && !data) {
    return <output className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Loading finance</output>;
  }
  if (status === 'error' && !data) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
        <span className="grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive"><AlertCircle className="size-5" aria-hidden="true" /></span>
        <h1 className="mt-4 font-heading text-xl font-semibold tracking-[-0.03em]">Finance data is unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">The account history could not be loaded. Refresh to try again.</p>
      </div>
    );
  }
  if (!data || data.dates.length === 0) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
        <span className="grid size-12 place-items-center rounded-full bg-secondary text-muted-foreground"><Database className="size-5" aria-hidden="true" /></span>
        <h1 className="mt-4 font-heading text-xl font-semibold tracking-[-0.03em]">Ready for the first snapshot</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Posted account snapshots will appear here automatically.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col py-3 sm:py-4 lg:h-full lg:min-h-0">
      <FinanceHeader view={view} onViewChange={changeView} latestReportDate={data.latestReportDate} />
      {status === 'error' && <p aria-live="polite" className="mb-2 rounded-lg bg-destructive/8 px-3 py-2 text-[11px] text-destructive">Refresh failed. Showing the last finance data loaded on this device.</p>}
      {view === 'overview'
        ? <Overview data={data} onExplore={exploreGroup} />
        : <HistoryWorkspace data={data} selectedGroup={selectedGroup} onSelectedGroupChange={setSelectedGroup} focusMetric={focusMetric} onFocusHandled={clearFocusMetric} />}
    </div>
  );
}
