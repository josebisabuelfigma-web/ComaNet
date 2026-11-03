import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getModulesWithStatus } from "@/lib/modules";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ModuleToggleList } from "@/components/superadmin/module-toggle-list";
import { OrganizationSettings } from "@/components/superadmin/organization-settings";
import { DeleteOrganization } from "@/components/superadmin/delete-organization";
import { ROLE_LABELS } from "@/lib/permissions";
import type { Organization, Profile } from "@/lib/supabase/types";

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const supabase = await createClient();

  const { data: organization } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .single();

  if (!organization) notFound();

  const [{ data: users }, modules] = await Promise.all([
    supabase
      .from("profiles")
      .select("*")
      .eq("organization_id", orgId)
      .order("role", { ascending: true }),
    getModulesWithStatus(orgId),
  ]);

  const org = organization as Organization;
  const userList = (users as Profile[]) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/superadmin"
          className="mb-2 inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Organizaciones
        </Link>
        <h1 className="text-2xl font-semibold text-brand-ink">{org.name}</h1>
        <p className="text-sm text-brand-muted">
          Carta pública: <span className="font-mono">/m/{org.slug}</span>
        </p>
      </div>

      <OrganizationSettings organization={org} />
      <ModuleToggleList organizationId={org.id} modules={modules} />

      <Card>
        <CardHeader>
          <CardTitle>Usuarios</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-brand-border">
          {userList.length === 0 && (
            <p className="text-sm text-brand-muted">Sin usuarios todavía.</p>
          )}
          {userList.map((user) => (
            <div key={user.id} className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium text-brand-ink">{user.full_name}</p>
                <p className="text-sm text-brand-muted">@{user.username}</p>
              </div>
              <span className="text-sm capitalize text-brand-muted">
                {ROLE_LABELS[user.role]}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <DeleteOrganization organizationId={org.id} organizationName={org.name} />
    </div>
  );
}
