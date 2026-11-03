import { requireOrgRole } from "@/lib/auth";
import { isModuleEnabled, MODULE_KEYS } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import {
  BusinessInfoForm,
  PublicLinkCard,
  SettingsForm,
  TablesManager,
} from "@/components/ajustes/ajustes-forms";
import type { Organization, RestaurantSettings, RestaurantTable } from "@/lib/supabase/types";

export default async function AjustesPage() {
  const profile = await requireOrgRole("owner");
  const supabase = await createClient();

  const [{ data: org }, { data: settings }, { data: tables }, menuEnabled, mesasEnabled] =
    await Promise.all([
      supabase.from("organizations").select("*").eq("id", profile.organization_id).single(),
      supabase
        .from("restaurant_settings")
        .select("*")
        .eq("organization_id", profile.organization_id)
        .single(),
      supabase
        .from("restaurant_tables")
        .select("*")
        .eq("organization_id", profile.organization_id)
        .order("sort_order")
        .order("created_at"),
      isModuleEnabled(profile.organization_id, MODULE_KEYS.MENU_ONLINE),
      isModuleEnabled(profile.organization_id, MODULE_KEYS.MESAS),
    ]);

  if (!org || !settings) {
    return <p className="text-sm text-brand-muted">No se pudo cargar la configuración.</p>;
  }

  const organization = org as Organization;
  const restaurantSettings = settings as RestaurantSettings;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-ink">Ajustes</h1>
        <p className="text-sm text-brand-muted">Configura tu negocio, domicilios y mesas.</p>
      </div>

      <PublicLinkCard
        slug={organization.slug}
        ordersOpen={restaurantSettings.orders_open}
        menuEnabled={menuEnabled}
      />
      <SettingsForm settings={restaurantSettings} />
      <BusinessInfoForm organization={organization} />
      {mesasEnabled && <TablesManager tables={(tables as RestaurantTable[]) ?? []} />}
    </div>
  );
}
