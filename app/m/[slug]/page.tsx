import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { PublicMenu } from "@/components/menu/public-menu";
import type {
  MenuCategory,
  MenuComboItem,
  MenuProduct,
  Organization,
  RestaurantSettings,
} from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

async function loadOrganization(slug: string) {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id, name, logo_url, currency, billing_address, is_active")
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  return org && org.is_active ? org : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const org = await loadOrganization(slug);
  return { title: org ? `${org.name} — Carta` : "Carta" };
}

export default async function PublicMenuPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const org = await loadOrganization(slug);
  if (!org) notFound();

  const admin = createAdminClient();

  const { data: moduleRow } = await admin
    .from("modules")
    .select("id")
    .eq("key", "menu_online")
    .maybeSingle();
  const { data: orgModule } = moduleRow
    ? await admin
        .from("organization_modules")
        .select("enabled")
        .eq("organization_id", org.id)
        .eq("module_id", moduleRow.id)
        .maybeSingle()
    : { data: null };

  if (!orgModule?.enabled) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
        <div>
          <h1 className="text-xl font-semibold text-brand-ink">{org.name}</h1>
          <p className="mt-2 text-brand-muted">La carta en línea no está disponible por ahora.</p>
        </div>
      </main>
    );
  }

  const [{ data: categories }, { data: products }, { data: comboItems }, { data: settings }] = await Promise.all([
    admin
      .from("menu_categories")
      .select("*")
      .eq("organization_id", org.id)
      .order("sort_order")
      .order("created_at"),
    admin
      .from("menu_products")
      .select("*")
      .eq("organization_id", org.id)
      .eq("is_active", true)
      .order("sort_order")
      .order("created_at"),
    admin.from("menu_combo_items").select("*").eq("organization_id", org.id),
    admin.from("restaurant_settings").select("*").eq("organization_id", org.id).single(),
  ]);

  if (!settings) notFound();

  return (
    <PublicMenu
      slug={slug.toLowerCase()}
      organization={org as Pick<Organization, "id" | "name" | "logo_url" | "currency" | "billing_address">}
      initialSettings={settings as RestaurantSettings}
      initialCategories={(categories as MenuCategory[]) ?? []}
      initialProducts={(products as MenuProduct[]) ?? []}
      initialComboItems={(comboItems as MenuComboItem[]) ?? []}
    />
  );
}
