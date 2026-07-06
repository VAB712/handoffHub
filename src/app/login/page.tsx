"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";

function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/workspaces";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl,
    });
    setPending(false);
    if (res?.error) {
      setError("Invalid user ID or password.");
      return;
    }
    window.location.href = callbackUrl;
  }

  return (
    <div className="relative flex min-h-screen items-start justify-center bg-white px-4 pt-10 sm:pt-12">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/logos/amdocslogo.png"
        alt="Amdocs"
        className="fixed bottom-4 right-4 h-10 w-auto sm:bottom-6 sm:right-6 sm:h-12"
      />
      <div className="w-full max-w-md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/logos/logo2.png"
          alt=""
          className="mx-auto mb-12 h-32 w-auto object-contain sm:mb-16 sm:h-40"
        />
        <h1 className="mb-3 text-center text-2xl font-semibold text-blue-900">Handoff Hub</h1>
        <div className="rounded-xl border border-blue-200/70 bg-gradient-to-br from-blue-50 via-cyan-50 to-emerald-50 p-8 shadow-md shadow-blue-100/40">
          <h2 className="text-center text-xl font-semibold text-blue-900">Sign in</h2>
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-blue-900/80" htmlFor="email">
                User ID
              </label>
              <input
                id="email"
                type="text"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-blue-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-blue-900/80" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-blue-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-gradient-to-r from-blue-600 to-emerald-500 py-2 text-sm font-medium text-white hover:from-blue-700 hover:to-emerald-600 disabled:opacity-50"
            >
              {pending ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white p-8 text-center text-slate-600">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
