"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Sends users to `/handoff/YYYY-MM-DD` using the browser's local calendar date. */
export function HomeRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/workspaces");
  }, [router]);

  return (
    <main className="flex min-h-[40vh] items-center justify-center px-4">
      <p className="text-sm text-slate-600">Redirecting…</p>
    </main>
  );
}
