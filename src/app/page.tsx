import Link from "next/link";

export const metadata = {
  title: "Open Finance — self-hosted, open-source personal finance",
  description:
    "Own your data. Bring your own Plaid keys — or track manually. Even bring your own AI agent — optional, but it's the headline.",
};

/** Landing: try the demo (10s), sign up, or sign in. Demo gated by DEMO_MODE. */
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-text">
      <div className="w-full max-w-2xl text-center">
        <div
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-2xl font-bold"
          style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          ₿
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Open Finance</h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-text-muted">
          The finance app that lets you <strong className="text-text">bring your own agent</strong> — and asks
          permission before it looks anywhere. Self-hosted, open source, MIT.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/register"
            className="w-full rounded-md px-6 py-3 text-center text-sm font-semibold text-white sm:w-auto"
            style={{ background: "var(--accent)" }}
          >
            Create an account
          </Link>
          <Link
            href="/login"
            className="w-full rounded-md border border-border bg-surface px-6 py-3 text-center text-sm font-medium text-text sm:w-auto"
          >
            Sign in
          </Link>
          <Link
            href="/demo"
            className="w-full rounded-md px-6 py-3 text-center text-sm font-medium text-accent sm:w-auto"
          >
            Try the live demo →
          </Link>
        </div>

        <div className="mx-auto mt-14 grid max-w-2xl gap-4 text-left sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface p-5">
            <p className="text-sm font-semibold">Your data</p>
            <p className="mt-1 text-sm text-text-muted">A SQLite file on your machine or your hub. We run nothing.</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-5">
            <p className="text-sm font-semibold">Your bank</p>
            <p className="mt-1 text-sm text-text-muted">Bring your own free Plaid keys — or skip banks entirely and track manually.</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-5">
            <p className="text-sm font-semibold">Your agent</p>
            <p className="mt-1 text-sm text-text-muted">Read-only by default. You control every read and write — change it anytime.</p>
          </div>
        </div>

        <p className="mt-10 text-xs text-text-muted">
          Desktop · Hub · Phone — one core, three shapes. Bills, debts, goals &amp; a 12-month projection built in.
        </p>
      </div>
    </main>
  );
}
