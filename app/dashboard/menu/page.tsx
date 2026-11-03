import { requireOrgRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MenuManager } from "@/components/menu/menu-manager";
import type { MenuCategory, MenuComboItem, MenuProduct } from "@/lib/supabase/types";

export default async function MenuPage() {
  const profile = await requireOrgRole("owner", "cajero");
  const supabase = await createClient();

  const [{ data: categories }, { data: products }, { data: comboItems }, { data: org }] = await Promise.all([
    supabase
      .from("menu_categories")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("menu_products")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .order("sort_order")
      .order("created_at"),
    supabase.from("menu_combo_items").select("*").eq("organization_id", profile.organization_id),
    supabase.from("organizations").select("currency").eq("id", profile.organization_id).single(),
  ]);

  return (
    <MenuManager
      categories={(categories as MenuCategory[]) ?? []}
      products={(products as MenuProduct[]) ?? []}
      comboItems={(comboItems as MenuComboItem[]) ?? []}
      currency={org?.currency ?? "COP"}
      canEdit={profile.role === "owner"}
    />
  );
}
