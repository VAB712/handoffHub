import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-4">
      <h1 className="text-xl font-semibold text-slate-900">Page not found</h1>
      <Link href="/" className="text-blue-600 underline">
        Go to today&apos;s handoff
      </Link>
    </div>
  );
}
