'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
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

function observedAccounts(data: FinanceDashboardResponse, date: string | undefined, group?: string) {
  if (!date) return new Set<string>();
  const ids = new Set<string>();
  for (const category of data.categories) {
    if (group && category.summaryGroup !== group) continue;
    const row = category.rows.find((item) => item.date === date);
    for (const account of category.accounts) {
      if (row?.values[account.id]) ids.add(account.id);
    }
  }
  return ids;
}

function sameSet(left: Set<string>, right: Set<string>) {
  return left.size === right.size && Array.from(left).every((item) => right.has(item));
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

function Delta({ value, dark = false }: { value: number | null; dark?: boolean }) {
  if (value === null) return <span className={dark ? 'text-white/55' : 'text-muted-foreground'}>No like-for-like comparison</span>;
  const Icon = value >= 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 ${dark ? 'text-white/70' : 'text-muted-foreground'}`}>
      <Icon className="size-3" aria-hidden="true" /> {value >= 0 ? '+' : ''}{formatCurrency(value)} since previous report
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
}: {
  label: string;
  value: number | null;
  delta: number | null;
  primary?: boolean;
  absolute?: boolean;
  note?: string;
}) {
  return (
    <article className={primary
      ? 'relative col-span-2 overflow-hidden rounded-[1.35rem] bg-[linear-gradient(145deg,#17293c_0%,#22465a_100%)] p-4 text-white shadow-[0_16px_35px_rgb(23_41_60/0.18)] sm:p-5 lg:col-span-2'
      : 'rounded-[1.35rem] border border-border bg-card p-4 shadow-[0_10px_28px_rgb(43_75_84/0.06)] sm:p-5'}>
      {primary && <div className="pointer-events-none absolute -right-8 -top-10 size-40 rounded-full bg-white/7 blur-2xl" />}
      <p className={`text-[10px] font-semibold uppercase tracking-[0.13em] ${primary ? 'text-white/55' : 'text-muted-foreground'}`}>{label}</p>
      <p className="mt-2 font-heading text-[clamp(1.45rem,4vw,2.35rem)] font-semibold leading-none tracking-[-0.055em] tabular-nums">
        {formatCurrency(value, false, absolute)}
      </p>
      <p className="mt-3 text-[11px] sm:text-xs"><Delta value={delta} dark={primary} /></p>
      {note && <p className={`mt-1 text-[10px] ${primary ? 'text-white/45' : 'text-muted-foreground'}`}>{note}</p>}
    </article>
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
    <button type="button" onClick={onExplore} aria-label={`Explore ${name} history`} className="group flex min-h-[108px] flex-col justify-between rounded-[1.15rem] border border-border bg-card p-3.5 text-left shadow-[0_8px_24px_rgb(43_75_84/0.045)] transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-[122px] sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <span className={`grid size-8 shrink-0 place-items-center rounded-xl ${visual.wash}`}><Icon className="size-4" aria-hidden="true" /></span>
        <span className="text-[9px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">{kind === 'debt' ? 'Amount owed' : `${Math.round(share)}% of assets`}</span>
      </div>
      <div className="mt-3 min-w-0">
        <p className="line-clamp-2 break-words text-xs font-medium leading-snug text-muted-foreground sm:text-sm">{name}</p>
        <div className="mt-1 flex items-end justify-between gap-2">
          <p className="truncate font-heading text-lg font-semibold tracking-[-0.04em] tabular-nums sm:text-xl">{formatCurrency(value, false, kind === 'debt')}</p>
          {delta !== null && <span className="mb-0.5 shrink-0 text-[10px] font-medium text-muted-foreground">{delta >= 0 ? '+' : ''}{formatCurrency(delta)}</span>}
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
          <h1 className="mt-1 font-heading text-[clamp(1.35rem,4vw,2.05rem)] font-semibold tracking-[-0.05em]">{view === 'overview' ? 'Current position' : 'History'}</h1>
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
          <History aria-hidden="true" /> History
        </Button>
      </div>
    </div>
  );
}

function Overview({ data, onExplore }: { data: FinanceDashboardResponse; onExplore: (group: string) => void }) {
  const latest = data.summary.rows.at(-1) ?? null;
  const previous = data.summary.rows.at(-2) ?? null;
  const kindByGroup = new Map(data.categories.map((category) => [category.summaryGroup, category.balanceKind]));
  const latestAccounts = observedAccounts(data, latest?.date);
  const previousAccounts = observedAccounts(data, previous?.date);
  const comparablePortfolio = sameSet(latestAccounts, previousAccounts);

  const groups = data.summary.columns.map((column) => {
    const value = numericValue(aggregateGroupValue(data, latest?.date, column.id));
    const previousValue = numericValue(aggregateGroupValue(data, previous?.date, column.id));
    const comparableGroup = sameSet(
      observedAccounts(data, latest?.date, column.id),
      observedAccounts(data, previous?.date, column.id),
    );
    const kind = kindByGroup.get(column.id) ?? 'asset';
    return {
      ...column,
      kind,
      value,
      previousValue,
      delta: comparableGroup && value !== null && previousValue !== null
        ? value - previousValue
        : null,
    } as const;
  });

  const assetGroups = groups.filter((group) => group.kind === 'asset');
  const debtGroups = groups.filter((group) => group.kind === 'debt');
  const assets = assetGroups.every((group) => group.value !== null)
    ? assetGroups.reduce((sum, group) => sum + (group.value ?? 0), 0)
    : null;
  const debtOwed = debtGroups.every((group) => group.value !== null)
    ? debtGroups.reduce((sum, group) => sum + (group.value ?? 0), 0)
    : null;
  const previousAssets = assetGroups.every((group) => group.previousValue !== null)
    ? assetGroups.reduce((sum, group) => sum + (group.previousValue ?? 0), 0)
    : null;
  const previousDebtOwed = debtGroups.every((group) => group.previousValue !== null)
    ? debtGroups.reduce((sum, group) => sum + (group.previousValue ?? 0), 0)
    : null;
  const trackedBalance = assets !== null && debtOwed !== null ? assets - debtOwed : null;
  const previousTrackedBalance = previousAssets !== null && previousDebtOwed !== null ? previousAssets - previousDebtOwed : null;
  const aggregateComparable = comparablePortfolio && previous && trackedBalance !== null && previousTrackedBalance !== null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-3 pr-0.5 [scrollbar-width:thin]">
      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3" aria-label="Latest tracked totals">
        <MetricCard
          label="Tracked balance"
          value={trackedBalance}
          delta={aggregateComparable ? trackedBalance - previousTrackedBalance : null}
          primary
          note="Recorded assets less recorded liabilities; not a net-worth estimate."
        />
        <MetricCard label="Tracked assets" value={assets} delta={comparablePortfolio && previous && assets !== null && previousAssets !== null ? assets - previousAssets : null} />
        <MetricCard label="Debt owed" value={debtOwed} delta={comparablePortfolio && previous && debtOwed !== null && previousDebtOwed !== null ? debtOwed - previousDebtOwed : null} />
      </section>

      <div className="mb-2 mt-4 flex items-end justify-between gap-3 sm:mt-5">
        <div>
          <h2 className="font-heading text-sm font-semibold tracking-[-0.02em] sm:text-base">Category breakdown</h2>
          <p className="mt-0.5 text-[10px] text-muted-foreground sm:text-xs">{groups.some((group) => group.value === null) ? 'An unavailable category is withheld from aggregate totals.' : `${latestAccounts.size} accounts reported · balance change since ${formatReportDate(previous?.date ?? null, true)}.`}</p>
        </div>
        <p className="hidden text-[10px] text-muted-foreground sm:block">Exact cents remain available in History</p>
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
  date: string;
  value: number | null;
  reported: boolean;
};

const HISTORY_PAGE_SIZES = [5, 10, 20];
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
  const values = data.summary.columns.map((column) => ({
    kind: kindByGroup.get(column.id) ?? 'asset',
    value: numericValue(aggregateGroupValue(data, row.date, column.id)),
  }));
  if (values.length === 0 || values.some((entry) => entry.value === null)) return null;
  return values.reduce((sum, entry) => sum + (entry.kind === 'debt' ? -Math.abs(entry.value ?? 0) : (entry.value ?? 0)), 0);
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

function buildDailySeries(data: FinanceDashboardResponse, group: string, debt: boolean) {
  if (data.dates.length === 0) return [];
  const byDate = new Map(data.summary.rows.map((row) => {
    const value = valueForGroup(data, row, group);
    return [row.date, value === null || !debt ? value : Math.abs(value)];
  }));
  const start = new Date(`${data.dates[0]}T00:00:00Z`);
  const end = new Date(`${data.dates.at(-1)}T00:00:00Z`);
  const points: HistoryPoint[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    points.push({ date, value: byDate.get(date) ?? null, reported: byDate.has(date) });
  }
  return points;
}

function compactCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
    .format(new Date(`${value}T00:00:00Z`));
}

function HistoryTrend({
  data,
  selectedGroup,
  selectedName,
  debt,
}: {
  data: FinanceDashboardResponse;
  selectedGroup: string;
  selectedName: string;
  debt: boolean;
}) {
  const series = useMemo(() => buildDailySeries(data, selectedGroup, debt), [data, selectedGroup, debt]);
  const latestRow = data.summary.rows.at(-1);
  const previousRow = data.summary.rows.at(-2);
  const latestRaw = valueForGroup(data, latestRow, selectedGroup);
  const previousRaw = valueForGroup(data, previousRow, selectedGroup);
  const latestValue = latestRaw === null || !debt ? latestRaw : Math.abs(latestRaw);
  const previousValue = previousRaw === null || !debt ? previousRaw : Math.abs(previousRaw);
  const comparable = sameSet(
    observedAccounts(data, latestRow?.date, selectedGroup === 'all' ? undefined : selectedGroup),
    observedAccounts(data, previousRow?.date, selectedGroup === 'all' ? undefined : selectedGroup),
  );
  const delta = comparable && latestValue !== null && previousValue !== null ? latestValue - previousValue : null;
  const gapCount = series.filter((point) => !point.reported).length;
  const reportCount = series.length - gapCount;
  const chartConfig = {
    value: { label: selectedName, color: '#2e7484' },
  } satisfies ChartConfig;

  return (
    <section className="rounded-[1.25rem] border border-border bg-card p-4 shadow-[0_10px_30px_rgb(43_75_84/0.06)] sm:p-5" aria-labelledby="history-trend-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-xl bg-primary/10 text-primary"><ChartNoAxesCombined className="size-4" aria-hidden="true" /></span>
            <div>
              <h2 id="history-trend-title" className="font-heading text-sm font-semibold sm:text-base">{selectedName} over time</h2>
              <p className="text-[10px] text-muted-foreground sm:text-xs">{reportCount} reports across {series.length} calendar days</p>
            </div>
          </div>
        </div>
        <div className="text-right">
          <p className="font-heading text-xl font-semibold tracking-[-0.04em] tabular-nums sm:text-2xl">{formatCurrency(latestValue)}</p>
          <p className="mt-1 text-[10px] sm:text-xs"><Delta value={delta} /></p>
        </div>
      </div>

      <ChartContainer config={chartConfig} className="mt-3 h-[180px] w-full aspect-auto sm:h-[210px]" aria-label={`${selectedName} balance history`}>
        <AreaChart
          data={series}
          accessibilityLayer
          title={`${selectedName} balance history`}
          desc={`${reportCount} reported balances across ${series.length} calendar days, with ${gapCount} unreported days shown as gaps.`}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="finance-history-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-value)" stopOpacity={0.28} />
              <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 5" />
          <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={32} tickFormatter={shortDate} />
          <YAxis tickLine={false} axisLine={false} width={54} tickFormatter={compactCurrency} />
          <ChartTooltip
            cursor={{ stroke: 'var(--border)' }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as HistoryPoint | undefined;
              if (!active || !point || point.value === null) return null;
              return (
                <div className="min-w-36 rounded-xl border border-border bg-popover px-3 py-2 text-popover-foreground shadow-xl">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{formatReportDate(point.date, true)}</p>
                  <p className="mt-1 font-mono text-sm font-semibold tabular-nums">{formatCurrency(point.value, true)}</p>
                </div>
              );
            }}
          />
          <Area dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2.25} fill="url(#finance-history-fill)" connectNulls={false} activeDot={{ r: 4 }} />
        </AreaChart>
      </ChartContainer>
      <div className="mt-1 flex items-center justify-between gap-4 text-[10px] text-muted-foreground sm:text-xs">
        <p>{gapCount === 0 ? 'Every calendar day is represented.' : `${gapCount} unreported ${gapCount === 1 ? 'day' : 'days'} shown as gaps.`}</p>
        <p className="hidden sm:block">Changes describe recorded balances, not investment returns.</p>
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
}: {
  data: FinanceDashboardResponse;
  selectedGroup: string;
  onSelectedGroupChange: (group: string) => void;
}) {
  const [page, setPage] = useState(0);
  const [pageSizeOverride, setPageSizeOverride] = useState<number | null>(null);
  const isMobile = useSyncExternalStore(subscribeToMobileHistory, mobileHistorySnapshot, () => false);
  const pageSize = pageSizeOverride ?? (isMobile ? 5 : 10);
  const selectedColumn = data.summary.columns.find((column) => column.id === selectedGroup);
  const safeGroup = selectedGroup === 'all' || selectedColumn ? selectedGroup : 'all';
  const selectedName = safeGroup === 'all' ? 'Tracked balance' : titleCase(selectedColumn?.name ?? safeGroup);
  const selectedKind = data.categories.find((category) => category.summaryGroup === safeGroup)?.balanceKind ?? 'asset';
  const descendingDates = useMemo(() => [...data.dates].sort((left, right) => right.localeCompare(left)), [data.dates]);
  const pageCount = Math.max(1, Math.ceil(descendingDates.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const firstIndex = safePage * pageSize;
  const visibleDates = descendingDates.slice(firstIndex, firstIndex + pageSize);

  function changeGroup(group: string | null) {
    if (!group) return;
    onSelectedGroupChange(group);
    setPage(0);
  }

  function changePageSize(value: string | null) {
    if (!value) return;
    setPageSizeOverride(Number(value));
    setPage(0);
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-3 pr-0.5 [scrollbar-width:thin]">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <label htmlFor="history-category" className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Category</label>
          <Select value={safeGroup} onValueChange={changeGroup}>
            <SelectTrigger id="history-category" className="h-11 min-w-52 rounded-xl bg-card px-3">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value="all">Tracked balance</SelectItem>
              {data.summary.columns.map((column) => <SelectItem key={column.id} value={column.id}>{titleCase(column.name)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <p className="max-w-sm text-[10px] leading-relaxed text-muted-foreground sm:text-right sm:text-xs">Choose a category to see its combined trend and the accounts behind each report.</p>
      </div>

      <HistoryTrend data={data} selectedGroup={safeGroup} selectedName={selectedName} debt={selectedKind === 'debt'} />

      <div className="mb-2 mt-4 flex items-center justify-between gap-4 sm:mt-5">
        <div>
          <h2 className="font-heading text-sm font-semibold sm:text-base">Reported snapshots</h2>
          <p className="text-[10px] text-muted-foreground sm:text-xs">Exact balances, newest first</p>
        </div>
        <p className="text-[10px] text-muted-foreground sm:text-xs">{firstIndex + 1}–{Math.min(firstIndex + pageSize, descendingDates.length)} of {descendingDates.length}</p>
      </div>

      <HistoryTable data={data} selectedGroup={safeGroup} selectedName={selectedName} dates={visibleDates} />
      <MobileHistoryList data={data} selectedGroup={safeGroup} dates={visibleDates} />

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
      <p className="pt-2 text-[10px] text-muted-foreground">Unavailable means a report was received without a usable balance. Missing dates remain visible as chart gaps.</p>
    </div>
  );
}

export function FinanceDashboard({ refreshToken }: { refreshToken: number }) {
  const [data, setData] = useState<FinanceDashboardResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [view, setView] = useState<FinanceView>('overview');
  const [selectedGroup, setSelectedGroup] = useState('all');

  useEffect(() => {
    const syncView = () => setView(window.location.hash === '#finance/history' ? 'history' : 'overview');
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

  function changeView(nextView: FinanceView) {
    setView(nextView);
    window.history.replaceState(null, '', nextView === 'overview' ? '#finance' : '#finance/history');
  }

  function exploreGroup(group: string) {
    setSelectedGroup(group);
    changeView('history');
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
    <div className="flex h-full min-h-0 flex-col py-3 sm:py-4">
      <FinanceHeader view={view} onViewChange={changeView} latestReportDate={data.latestReportDate} />
      {status === 'error' && <p aria-live="polite" className="mb-2 rounded-lg bg-destructive/8 px-3 py-2 text-[11px] text-destructive">Refresh failed. Showing the last finance data loaded on this device.</p>}
      {view === 'overview'
        ? <Overview data={data} onExplore={exploreGroup} />
        : <HistoryWorkspace data={data} selectedGroup={selectedGroup} onSelectedGroupChange={setSelectedGroup} />}
    </div>
  );
}
