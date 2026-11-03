import Link from "next/link";
import { Plus } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Organization } from "@/lib/supabase/types";

export default async function SuperAdminHomePage() {
  const supabase = await createClient();
  const { data: organizations } = await supabase
    .from("organizations")
    .select("*")
    .order("created_at", { ascending: false });

  const list = (organizations as Organization[]) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-ink">Organizaciones</h1>
          <p className="text-sm text-brand-muted">
            Cada negocio que compra el sistema aparece aquí.
          </p>
        </div>
        <Link href="/superadmin/organizaciones/nueva">
          <Button>
            <Plus className="h-4 w-4" />
            Nueva organización
          </Button>
        </Link>
      </div>

      {list.length === 0 ? (
        <div className="rounded-[var(--radius-brand-md)] border border-dashed border-brand-border bg-white p-10 text-center text-brand-muted">
          Aún no has creado ninguna organización.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((org) => (
            <Link key={org.id} href={`/superadmin/organizaciones/${org.id}`}>
              <Card className="transition-shadow hover:shadow-md">
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium text-brand-ink">{org.name}</p>
                    <p className="text-sm text-brand-muted">/{org.slug}</p>
                  </div>
                  <Badge variant={org.is_active ? "success" : "danger"}>
                    {org.is_active ? "Activa" : "Suspendida"}
                  </Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
