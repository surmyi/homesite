import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import { forbidden } from 'next/navigation';

import { SiteApp } from './site-app';
import { getAuthContext } from '@/lib/site-auth';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

function AppHeader({ action }: { action: React.ReactNode }) {
  return (
    <header className="mx-auto grid h-16 max-w-[1480px] grid-cols-[1fr_auto_1fr] items-center border-b border-border/70">
      <span className="font-heading text-lg font-semibold tracking-[-0.04em]">
        surmyi<span className="text-primary">.</span>
      </span>
      <span className="rounded-full bg-muted px-4 py-1.5 text-sm font-medium">
        Home
      </span>
      <div className="flex justify-end">{action}</div>
    </header>
  );
}

function SignedOut({ mode }: { mode: 'sites' | 'google' }) {
  const startPath =
    mode === 'google'
      ? '/auth/google/start'
      : '/signin-with-chatgpt?return_to=/';
  const loginHref =
    mode === 'google' && env.APP_ORIGIN
      ? new URL(startPath, env.APP_ORIGIN).toString()
      : startPath;
  const label = mode === 'google' ? 'Log in with Google' : 'Log in';
  return (
    <main className="h-dvh overflow-hidden bg-background px-4 text-foreground sm:px-8 lg:px-12">
      <AppHeader
        action={
          <a
            href={loginHref}
            target="_top"
            className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85"
          >
            Log in
          </a>
        }
      />
      <section className="mx-auto flex h-[calc(100dvh-4rem)] max-w-[1480px] items-center justify-center">
        <div className="max-w-md text-center">
          <p className="eyebrow">Private home</p>
          <h1 className="mt-3 font-heading text-4xl font-medium tracking-[-0.055em] sm:text-5xl">
            Welcome to surmyi.
          </h1>
          <p className="mt-4 text-sm leading-6 text-muted-foreground sm:text-base">
            Sign in to open this private site.
          </p>
          <a
            href={loginHref}
            target="_top"
            className="mt-7 inline-flex rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-85"
          >
            {label}
          </a>
        </div>
      </section>
    </main>
  );
}

export default async function Home() {
  const requestHeaders = await headers();
  const context = await getAuthContext(requestHeaders);
  if (context.reason === 'unauthenticated')
    return <SignedOut mode={context.mode} />;
  if (!context.user) forbidden();
  return <SiteApp currentUser={context.user} />;
}
