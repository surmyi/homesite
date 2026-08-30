'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Database, LoaderCircle, WalletCards } from 'lucide-react';

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
  categories: Array<{
    id: string;
    name: string;
    summaryGroup: string;
    balanceKind: string;
    accounts: FinanceAccount[];
    rows: FinanceRow[];
  }>;
};

function formatAmount(value: FinanceValue) {
  if (!value) return '';
  if (!value.ok || value.balance === null) return `<error: ${value.errorType ?? 'incomplete data'}>`;
  const formatted = Math.abs(value.balance).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value.balance < 0 ? `(${formatted})` : formatted;
}

function titleCase(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatReportDate(value: string | null) {
  if (!value) return 'No snapshots yet';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00Z`));
}

function SummaryMatrix({ data }: { data: FinanceDashboardResponse }) {
  return (
    <Table className="min-w-[760px] border-separate border-spacing-0 text-[13px]">
      <TableHeader className="sticky top-0 z-20 bg-card/95 backdrop-blur">
        <TableRow className="hover:bg-transparent">
          <TableHead className="sticky left-0 z-30 w-32 min-w-32 border-b border-r bg-card/95 px-4 font-semibold">date</TableHead>
          {data.summary.columns.map((column) => (
            <TableHead key={column.id} className="min-w-40 border-b px-4 text-right font-semibold capitalize">
              {column.name}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.summary.rows.map((row) => (
          <TableRow key={row.date} className="hover:bg-muted/35">
            <TableCell className="sticky left-0 z-10 border-r bg-card px-4 font-mono text-xs text-muted-foreground">{row.date}</TableCell>
            {data.summary.columns.map((column) => {
              const value = row.values[column.id];
              return (
                <TableCell key={column.id} className={`px-4 text-right font-mono tabular-nums ${value && !value.ok ? 'text-destructive' : ''}`}>
                  {formatAmount(value)}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AccountMatrix({ data, categoryId }: { data: FinanceDashboardResponse; categoryId: string }) {
  const category = data.categories.find((item) => item.id === categoryId);
  if (!category) return null;

  return (
    <Table className="min-w-max border-separate border-spacing-0 text-[13px]">
      <TableHeader className="sticky top-0 z-20 bg-card/95 backdrop-blur">
        <TableRow className="hover:bg-transparent">
          <TableHead className="sticky left-0 z-30 w-32 min-w-32 border-b border-r bg-card/95 px-4 font-semibold">date</TableHead>
          {category.accounts.map((account) => (
            <TableHead key={account.id} className="h-auto min-w-48 max-w-56 border-b px-4 py-3 align-bottom whitespace-normal">
              <span className="block text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{account.institution}</span>
              <span className="mt-1 block text-sm font-medium leading-tight text-foreground">{account.account}</span>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {category.rows.map((row) => (
          <TableRow key={row.date} className="hover:bg-muted/35">
            <TableCell className="sticky left-0 z-10 border-r bg-card px-4 font-mono text-xs text-muted-foreground">{row.date}</TableCell>
            {category.accounts.map((account) => {
              const value = row.values[account.id];
              return (
                <TableCell key={account.id} className={`px-4 text-right font-mono tabular-nums ${value && !value.ok ? 'text-destructive' : ''}`}>
                  {formatAmount(value)}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function FinanceDashboard({ refreshToken }: { refreshToken: number }) {
  const [data, setData] = useState<FinanceDashboardResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedSheet, setSelectedSheet] = useState('summary');

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

  const selectedName = useMemo(() => {
    if (selectedSheet === 'summary') return 'Summary';
    return data?.categories.find((category) => category.id === selectedSheet)?.name ?? titleCase(selectedSheet);
  }, [data, selectedSheet]);

  if (status === 'loading' && !data) {
    return <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Loading finance history</div>;
  }

  if (status === 'error' && !data) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
        <span className="grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive"><AlertCircle className="size-5" /></span>
        <h1 className="mt-4 font-heading text-xl font-semibold tracking-[-0.03em]">Finance data is unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">The account history could not be loaded. Refresh to try again.</p>
      </div>
    );
  }

  if (!data || data.dates.length === 0) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
        <span className="grid size-12 place-items-center rounded-full bg-secondary text-muted-foreground"><Database className="size-5" /></span>
        <h1 className="mt-4 font-heading text-xl font-semibold tracking-[-0.03em]">Ready for the first snapshot</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Posted account snapshots will appear here as a date-by-account history.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col py-3 sm:py-5">
      <div className="flex shrink-0 items-end justify-between gap-4 pb-3 sm:pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <WalletCards className="size-3.5" /> Finance
          </div>
          <h1 className="mt-1 font-heading text-[clamp(1.35rem,4vw,2.1rem)] font-semibold tracking-[-0.05em]">Account history</h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{data.dates.length} reporting dates · {data.accountCount} accounts</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Latest snapshot</p>
          <p className="mt-1 text-sm font-medium sm:text-base">{formatReportDate(data.latestReportDate)}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Finance sheets">
        <button
          type="button"
          role="tab"
          aria-selected={selectedSheet === 'summary'}
          onClick={() => setSelectedSheet('summary')}
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${selectedSheet === 'summary' ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:text-foreground'}`}
        >
          Summary
        </button>
        {data.categories.map((category) => (
          <button
            type="button"
            role="tab"
            aria-selected={selectedSheet === category.id}
            key={category.id}
            onClick={() => setSelectedSheet(category.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${selectedSheet === category.id ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:text-foreground'}`}
          >
            {category.name}
          </button>
        ))}
      </div>

      <section className="finance-table-host min-h-0 flex-1 overflow-hidden rounded-[1.25rem] border border-border bg-card shadow-[0_12px_35px_rgb(43_75_84/0.08)] [&>[data-slot=table-container]]:h-full [&>[data-slot=table-container]]:overflow-auto" aria-label={`${selectedName} finance history`}>
        {selectedSheet === 'summary'
          ? <SummaryMatrix data={data} />
          : <AccountMatrix data={data} categoryId={selectedSheet} />}
      </section>

      <p className="shrink-0 pt-2 text-[10px] text-muted-foreground sm:text-xs">Blank cells mean no observation was reported for that account and date. Missing dates remain intentionally absent.</p>
    </div>
  );
}
