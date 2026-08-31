export default function Forbidden() {
  return (
    <main className="h-dvh overflow-hidden bg-background px-4 text-foreground sm:px-8 lg:px-12">
      <header className="mx-auto grid h-16 max-w-[1480px] grid-cols-[1fr_auto_1fr] items-center border-b border-border/70">
        <span className="font-heading text-lg font-semibold tracking-[-0.04em]">
          surmyi<span className="text-primary">.</span>
        </span>
        <span className="rounded-full bg-muted px-4 py-1.5 text-sm font-medium">
          Home
        </span>
        <form action="/auth/logout" method="get" className="flex justify-end">
          <button
            type="submit"
            className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium"
          >
            Log out
          </button>
        </form>
      </header>
      <section className="mx-auto flex h-[calc(100dvh-4rem)] max-w-[1480px] items-center justify-center">
        <div className="max-w-lg rounded-3xl border border-border bg-card p-8 text-center shadow-sm sm:p-12">
          <p className="eyebrow">Access restricted</p>
          <h1 className="mt-3 font-heading text-3xl font-medium tracking-[-0.045em]">
            This account is not on the list.
          </h1>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            You are signed in, but this account does not currently have access
            to surmyi.
          </p>
          <form action="/auth/logout" method="get">
            <button
              type="submit"
              className="mt-7 inline-flex rounded-full border border-border bg-background px-5 py-2.5 text-sm font-medium"
            >
              Use another account
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
