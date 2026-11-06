import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

/** Enlaces temporales (1 hora) para ver las facturas del bucket privado. */
export async function signInvoiceUrls(
  supabase: SupabaseClient<Database>,
  paths: string[]
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (paths.length === 0) return urls;
  const { data } = await supabase.storage.from("facturas").createSignedUrls(paths, 3600);
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) urls.set(row.path, row.signedUrl);
  }
  return urls;
}

export function isPdf(path: string | null | undefined) {
  return !!path && path.toLowerCase().endsWith(".pdf");
}
