"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toggleModule } from "@/lib/actions/superadmin";
import type { ModuleStatus } from "@/lib/modules";

const currency = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

interface ModuleToggleListProps {
  organizationId: string;
  modules: ModuleStatus[];
}

export function ModuleToggleList({ organizationId, modules }: ModuleToggleListProps) {
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  async function handleToggle(moduleId: string, enabled: boolean) {
    setPendingId(moduleId);
    await toggleModule(organizationId, moduleId, enabled);
    setPendingId(null);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Módulos</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-brand-border">
        {modules.map((mod) => (
          <div key={mod.id} className="flex items-center justify-between py-3">
            <div>
              <p className="font-medium text-brand-ink">{mod.name}</p>
              <p className="text-sm text-brand-muted">
                {mod.description}
                {mod.price > 0 && ` · ${currency.format(mod.price)}/mes`}
              </p>
            </div>
            <Switch
              checked={mod.enabled}
              disabled={pendingId === mod.id}
              onCheckedChange={(checked) => handleToggle(mod.id, checked)}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
