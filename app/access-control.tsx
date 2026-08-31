'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  XCircle,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type AccessControlCurrentUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: 'admin' | 'viewer';
};

export type AccessControlProps = {
  currentUser: AccessControlCurrentUser;
};

type AccessRole = 'admin' | 'viewer';
type AccessStatus = 'active' | 'disabled';

type AccessUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: AccessRole;
  status: AccessStatus;
  lastLoginAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type AccessForm = {
  email: string;
  displayName: string;
  role: AccessRole;
  status: AccessStatus;
};

type FormMode = { kind: 'create' } | { kind: 'edit'; user: AccessUser };

const EMPTY_FORM: AccessForm = {
  email: '',
  displayName: '',
  role: 'viewer',
  status: 'active',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function normalizeUser(value: unknown): AccessUser | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.email !== 'string'
  ) {
    return null;
  }

  const status =
    value.status === 'disabled' ||
    value.active === false ||
    value.isActive === false
      ? 'disabled'
      : 'active';

  return {
    id: value.id,
    email: value.email,
    displayName: nullableString(value.displayName ?? value.display_name),
    role: value.role === 'admin' ? 'admin' : 'viewer',
    status,
    lastLoginAt: nullableString(value.lastLoginAt ?? value.last_login_at),
    createdAt: nullableString(value.createdAt ?? value.created_at),
    updatedAt: nullableString(value.updatedAt ?? value.updated_at),
  };
}

function normalizeUsers(payload: unknown): AccessUser[] {
  const candidates = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.users)
      ? payload.users
      : isRecord(payload) && Array.isArray(payload.items)
        ? payload.items
        : null;

  if (!candidates) {
    throw new Error('The access service returned an unexpected response.');
  }

  return candidates
    .map(normalizeUser)
    .filter((user): user is AccessUser => Boolean(user))
    .sort((left, right) => {
      if (left.status !== right.status)
        return left.status === 'active' ? -1 : 1;
      if (left.role !== right.role) return left.role === 'admin' ? -1 : 1;
      return left.email.localeCompare(right.email);
    });
}

function errorMessage(payload: unknown, status: number) {
  if (typeof payload === 'string' && payload.trim()) return payload;
  if (isRecord(payload)) {
    if (typeof payload.message === 'string') return payload.message;
    if (typeof payload.error === 'string') return payload.error;
    if (isRecord(payload.error) && typeof payload.error.message === 'string') {
      return payload.error.message;
    }
  }

  if (status === 401)
    return 'Your session has expired. Sign in again to continue.';
  if (status === 403)
    return 'You do not have permission to manage site access.';
  return `The request failed (${status}). Please try again.`;
}

async function requestJson(url: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers,
  });
  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = text;
    }
  }

  if (!response.ok) throw new Error(errorMessage(payload, response.status));
  return payload;
}

async function fetchAccessUsers() {
  return normalizeUsers(
    await requestJson('/api/admin/access', { cache: 'no-store' }),
  );
}

function formatActivity(value: string | null) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(date);
}

function initials(user: Pick<AccessUser, 'displayName' | 'email'>) {
  const source = user.displayName?.trim() || user.email.split('@')[0] || '?';
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return (
    parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : source.slice(0, 2)
  ).toUpperCase();
}

function RoleBadge({ role }: { role: AccessRole }) {
  return (
    <Badge
      variant={role === 'admin' ? 'default' : 'outline'}
      className="capitalize"
    >
      {role === 'admin' && <ShieldCheck aria-hidden="true" />}
      {role}
    </Badge>
  );
}

function StatusBadge({ status }: { status: AccessStatus }) {
  return status === 'active' ? (
    <Badge
      className="bg-emerald-600/10 text-emerald-700 dark:text-emerald-300"
      variant="secondary"
    >
      <CheckCircle2 aria-hidden="true" /> Active
    </Badge>
  ) : (
    <Badge variant="secondary" className="text-muted-foreground">
      <XCircle aria-hidden="true" /> Disabled
    </Badge>
  );
}

export function AccessControl({ currentUser }: AccessControlProps) {
  const [users, setUsers] = useState<AccessUser[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [form, setForm] = useState<AccessForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AccessUser | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setRefreshing(true);
    setPageError(null);

    try {
      setUsers(await fetchAccessUsers());
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : 'Unable to load site access.',
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchAccessUsers()
      .then((nextUsers) => {
        if (!cancelled) setUsers(nextUsers);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setPageError(
            error instanceof Error
              ? error.message
              : 'Unable to load site access.',
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!users || !normalizedQuery) return users ?? [];
    return users.filter((user) =>
      [user.email, user.displayName, user.role, user.status]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [query, users]);

  const stats = useMemo(() => {
    const all = users ?? [];
    return {
      total: all.length,
      admins: all.filter(
        (user) => user.role === 'admin' && user.status === 'active',
      ).length,
      disabled: all.filter((user) => user.status === 'disabled').length,
    };
  }, [users]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormMode({ kind: 'create' });
  }

  function openEdit(user: AccessUser) {
    setForm({
      email: user.email,
      displayName: user.displayName ?? '',
      role: user.role,
      status: user.status,
    });
    setFormError(null);
    setFormMode({ kind: 'edit', user });
  }

  function closeForm(open: boolean) {
    if (!open && !formBusy) {
      setFormMode(null);
      setFormError(null);
    }
  }

  async function saveUser(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formMode || formBusy) return;

    const email = form.email.trim().toLocaleLowerCase();
    if (!email) {
      setFormError('Enter the Google account email to allow.');
      return;
    }

    setFormBusy(true);
    setFormError(null);
    setNotice(null);
    setPageError(null);

    const isCreating = formMode.kind === 'create';
    const url = isCreating
      ? '/api/admin/access'
      : `/api/admin/access/${formMode.user.id}`;

    try {
      await requestJson(url, {
        method: isCreating ? 'POST' : 'PATCH',
        body: JSON.stringify({
          email,
          displayName: form.displayName.trim() || null,
          role: form.role,
          status: form.status,
        }),
      });
      setFormMode(null);
      setNotice(
        isCreating
          ? `${email} can now access the site.`
          : `Access for ${email} was updated.`,
      );
      await loadUsers();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Unable to save this person.',
      );
    } finally {
      setFormBusy(false);
    }
  }

  async function setEnabled(user: AccessUser, enabled: boolean) {
    if (busyUserId) return;
    setBusyUserId(user.id);
    setNotice(null);
    setPageError(null);

    try {
      await requestJson(`/api/admin/access/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: enabled ? 'active' : 'disabled' }),
      });
      setNotice(`${user.email} was ${enabled ? 'enabled' : 'disabled'}.`);
      await loadUsers();
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : 'Unable to update access.',
      );
    } finally {
      setBusyUserId(null);
    }
  }

  function askToDelete(user: AccessUser) {
    setDeleteError(null);
    setPendingDelete(user);
  }

  async function deleteUser() {
    if (!pendingDelete || busyUserId) return;
    const user = pendingDelete;
    setBusyUserId(user.id);
    setDeleteError(null);
    setNotice(null);
    setPageError(null);

    try {
      await requestJson(`/api/admin/access/${user.id}`, { method: 'DELETE' });
      setPendingDelete(null);
      setNotice(`${user.email} was removed from site access.`);
      await loadUsers();
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : 'Unable to remove this person.',
      );
    } finally {
      setBusyUserId(null);
    }
  }

  function isCurrentUser(user: AccessUser) {
    return (
      user.id === currentUser.id ||
      user.email.toLocaleLowerCase() === currentUser.email.toLocaleLowerCase()
    );
  }

  function UserActions({ user }: { user: AccessUser }) {
    const busy = busyUserId === user.id;
    return (
      <div className="flex items-center justify-end gap-3">
        <label className="flex min-h-9 items-center gap-2 text-xs text-muted-foreground">
          <span className="sr-only">
            {user.status === 'active' ? 'Disable' : 'Enable'} {user.email}
          </span>
          {busy ? (
            <Loader2
              className="size-4 animate-spin"
              aria-label="Updating access"
            />
          ) : (
            <Switch
              checked={user.status === 'active'}
              onCheckedChange={(checked) => void setEnabled(user, checked)}
              aria-label={`${user.status === 'active' ? 'Disable' : 'Enable'} access for ${user.email}`}
            />
          )}
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Actions for ${user.email}`}
              />
            }
          >
            <MoreHorizontal aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem onClick={() => openEdit(user)}>
              <Pencil aria-hidden="true" /> Edit access
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => askToDelete(user)}
            >
              <Trash2 aria-hidden="true" /> Remove person
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <section
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[1.4rem] border border-border bg-card/65 shadow-[0_14px_44px_rgb(43_75_84/0.07)]"
      aria-labelledby="access-control-title"
    >
      <header className="shrink-0 border-b border-border bg-card/80 px-4 py-4 backdrop-blur sm:px-5 sm:py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow">Administration</p>
            <h1
              id="access-control-title"
              className="mt-1 font-heading text-xl font-semibold tracking-tight sm:text-2xl"
            >
              Site access
            </h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
              Choose who can sign in with Google and what they can manage.
            </p>
          </div>
          <Button
            type="button"
            onClick={openCreate}
            className="min-h-10 rounded-xl px-3 sm:min-h-9"
          >
            <Plus aria-hidden="true" />
            <span className="hidden sm:inline">Add person</span>
            <span className="sm:hidden">Add</span>
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-background/60 px-1 py-2.5">
          <div className="px-2 sm:px-4">
            <p className="text-lg font-semibold tabular-nums sm:text-xl">
              {loading ? '—' : stats.total}
            </p>
            <p className="text-[10px] text-muted-foreground sm:text-xs">
              People
            </p>
          </div>
          <div className="px-2 sm:px-4">
            <p className="text-lg font-semibold tabular-nums sm:text-xl">
              {loading ? '—' : stats.admins}
            </p>
            <p className="text-[10px] text-muted-foreground sm:text-xs">
              Active admins
            </p>
          </div>
          <div className="px-2 sm:px-4">
            <p className="text-lg font-semibold tabular-nums sm:text-xl">
              {loading ? '—' : stats.disabled}
            </p>
            <p className="text-[10px] text-muted-foreground sm:text-xs">
              Disabled
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people"
              aria-label="Search site access"
              className="h-10 rounded-xl bg-background pl-9 sm:h-9"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void loadUsers()}
            disabled={loading || refreshing}
            aria-label="Refresh site access"
            className="size-10 rounded-xl sm:size-9"
          >
            <RefreshCw
              className={refreshing ? 'animate-spin' : ''}
              aria-hidden="true"
            />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [scrollbar-gutter:stable] [scrollbar-width:thin] sm:p-4">
        <div aria-live="polite" className="space-y-3">
          {notice && (
            <Alert className="border-emerald-600/20 bg-emerald-600/5 text-emerald-800 dark:text-emerald-200">
              <CheckCircle2 aria-hidden="true" />
              <AlertTitle>Access updated</AlertTitle>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}
          {pageError && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>Couldn’t update site access</AlertTitle>
              <AlertDescription>{pageError}</AlertDescription>
            </Alert>
          )}
        </div>

        {loading && !users ? (
          <div className="mt-3 space-y-2" aria-label="Loading site access">
            {[0, 1, 2].map((item) => (
              <Skeleton key={item} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="mt-3 grid min-h-48 place-items-center rounded-xl border border-dashed border-border bg-background/45 px-6 text-center">
            <div className="max-w-sm">
              <Users
                className="mx-auto size-6 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="mt-3 text-sm font-medium">
                {users?.length
                  ? 'No people match your search'
                  : 'No one has access yet'}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {users?.length
                  ? 'Try a different name, email, role, or status.'
                  : 'Add an administrator to start managing site access.'}
              </p>
              {!users?.length && (
                <Button
                  type="button"
                  size="sm"
                  onClick={openCreate}
                  className="mt-4"
                >
                  <Plus aria-hidden="true" /> Add person
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="mt-3 space-y-2 md:hidden">
              {filteredUsers.map((user) => (
                <article
                  key={user.id}
                  className="rounded-xl border border-border bg-background/65 p-3.5"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                      aria-hidden="true"
                    >
                      {initials(user)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h2 className="break-words text-sm font-semibold">
                          {user.displayName || user.email}
                        </h2>
                        {isCurrentUser(user) && (
                          <Badge variant="outline">You</Badge>
                        )}
                      </div>
                      {user.displayName && (
                        <p className="mt-0.5 break-all text-xs text-muted-foreground">
                          {user.email}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <RoleBadge role={user.role} />
                        <StatusBadge status={user.status} />
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-2.5">
                    <p className="text-[11px] text-muted-foreground">
                      Last sign-in{' '}
                      <span className="font-medium text-foreground">
                        {formatActivity(user.lastLoginAt)}
                      </span>
                    </p>
                    <UserActions user={user} />
                  </div>
                </article>
              ))}
            </div>

            <div className="mt-3 hidden overflow-hidden rounded-xl border border-border bg-background/55 md:block">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">Person</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last sign-in</TableHead>
                    <TableHead className="pr-4 text-right">Access</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="max-w-0 py-3 pl-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <div
                            className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                            aria-hidden="true"
                          >
                            {initials(user)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="break-words font-medium whitespace-normal">
                                {user.displayName || user.email}
                              </p>
                              {isCurrentUser(user) && (
                                <Badge variant="outline">You</Badge>
                              )}
                            </div>
                            {user.displayName && (
                              <p className="break-all text-xs text-muted-foreground whitespace-normal">
                                {user.email}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <RoleBadge role={user.role} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={user.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatActivity(user.lastLoginAt)}
                      </TableCell>
                      <TableCell className="pr-4">
                        <UserActions user={user} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>

      <Dialog open={Boolean(formMode)} onOpenChange={closeForm}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={saveUser}>
            <DialogHeader>
              <DialogTitle>
                {formMode?.kind === 'edit'
                  ? 'Edit site access'
                  : 'Add a person'}
              </DialogTitle>
              <DialogDescription>
                Access is granted to this exact Google account. Changes take
                effect immediately.
              </DialogDescription>
            </DialogHeader>

            <div className="my-5 space-y-4">
              <label
                htmlFor="access-email"
                className="block text-sm font-medium"
              >
                Email address
                <Input
                  id="access-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  disabled={formBusy}
                  className="mt-1.5 h-10"
                  placeholder="name@gmail.com"
                />
              </label>

              <label
                htmlFor="access-display-name"
                className="block text-sm font-medium"
              >
                Display name{' '}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
                <Input
                  id="access-display-name"
                  value={form.displayName}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      displayName: event.target.value,
                    }))
                  }
                  disabled={formBusy}
                  className="mt-1.5 h-10"
                  placeholder="Name shown in the control plane"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label
                  htmlFor="access-role"
                  className="block text-sm font-medium"
                >
                  Role
                  <Select
                    value={form.role}
                    onValueChange={(value) =>
                      value &&
                      setForm((current) => ({
                        ...current,
                        role: value as AccessRole,
                      }))
                    }
                    disabled={formBusy}
                  >
                    <SelectTrigger
                      id="access-role"
                      className="mt-1.5 h-10 w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectItem value="viewer">
                        <UserRound aria-hidden="true" /> Viewer
                      </SelectItem>
                      <SelectItem value="admin">
                        <ShieldCheck aria-hidden="true" /> Admin
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label
                  htmlFor="access-status"
                  className="block text-sm font-medium"
                >
                  Status
                  <Select
                    value={form.status}
                    onValueChange={(value) =>
                      value &&
                      setForm((current) => ({
                        ...current,
                        status: value as AccessStatus,
                      }))
                    }
                    disabled={formBusy}
                  >
                    <SelectTrigger
                      id="access-status"
                      className="mt-1.5 h-10 w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectItem value="active">
                        <CheckCircle2 aria-hidden="true" /> Active
                      </SelectItem>
                      <SelectItem value="disabled">
                        <XCircle aria-hidden="true" /> Disabled
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>

              {formError && (
                <Alert variant="destructive">
                  <AlertCircle aria-hidden="true" />
                  <AlertTitle>Couldn’t save access</AlertTitle>
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => closeForm(false)}
                disabled={formBusy}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={formBusy}>
                {formBusy && (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                )}
                {formMode?.kind === 'edit' ? 'Save changes' : 'Grant access'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open && !busyUserId) {
            setPendingDelete(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2 aria-hidden="true" />
            </AlertDialogMedia>
            <AlertDialogTitle>Remove site access?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.email} will be signed out and will no longer be
              able to view this site. You can add them again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(busyUserId)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void deleteUser()}
              disabled={Boolean(busyUserId)}
            >
              {busyUserId && (
                <Loader2 className="animate-spin" aria-hidden="true" />
              )}
              Remove access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
