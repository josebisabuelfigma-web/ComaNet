import Link from "next/link";

import { BrandFooter } from "@/components/brand-footer";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <h1 className="text-2xl font-semibold text-brand-ink">ComaNet</h1>
      <p className="mt-2 text-brand-muted">No encontramos esta página.</p>
      <Link href="/" className="mt-4 text-sm font-medium text-brand-dark underline">
        Ir al inicio
      </Link>
      <BrandFooter className="mt-8" />
    </main>
  );
}
