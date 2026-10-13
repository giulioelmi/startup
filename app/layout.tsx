import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

// Every page reads live data (Epic, the database): never prerender.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TransferAI",
  description: "AI-assisted inter-facility patient transfers",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-800 antialiased">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <nav className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm font-medium text-slate-600 sm:px-6">
            <Link href="/" className="flex items-center gap-2 text-base font-bold text-slate-900">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-teal-700 text-sm text-white">T</span>
              TransferAI
            </Link>
            <Link href="/" className="hover:text-teal-700">Transfers</Link>
            <Link href="/facilities" className="hover:text-teal-700">Facilities</Link>
            <Link href="/forms" className="hover:text-teal-700">Forms</Link>
            <Link href="/voice" className="hover:text-teal-700">Voice agent</Link>
            <Link href="/patients" className="btn ml-auto">+ New transfer</Link>
          </nav>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
