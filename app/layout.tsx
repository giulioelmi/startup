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
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <header className="border-b bg-white">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 text-sm">
            <Link href="/" className="text-base font-bold text-blue-800">TransferAI</Link>
            <Link href="/">Patients</Link>
            <Link href="/transfers">Transfers</Link>
            <Link href="/forms">Forms</Link>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
