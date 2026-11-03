"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateMaxUsuarios, toggleOrganizationActive } from "@/lib/actions/superadmin";
import type { Organization } from "@/lib/supabase/types";

export function OrganizationSettings({ organization }: { organization: Organization }) {
  const router = useRouter();
  const [maxUsuarios, setMaxUsuarios] = React.useState(organization.max_usuarios);
  const [saving, setSaving] = React.useState(false);
  const [togglingActive, setTogglingActive] = React.useState(false);

  async function handleSaveLimit() {
    setSaving(true);
    await updateMaxUsuarios(organization.id, maxUsuarios);
    setSaving(false);
    router.refresh();
  }

  async function handleToggleActive(checked: boolean) {
    setTogglingActive(true);
    await toggleOrganizationActive(organization.id, checked);
    setTogglingActive(false);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuración de la organización</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-brand-ink">Acceso activo</p>
            <p className="text-sm text-brand-muted">
              Si lo desactivas, ningún usuario podrá iniciar sesión y la carta pública deja de
              funcionar.
            </p>
          </div>
          <Switch
            checked={organization.is_active}
            disabled={togglingActive}
            onCheckedChange={handleToggleActive}
          />
        </div>

        <div className="flex flex-col gap-1.5 sm:max-w-xs">
          <Label htmlFor="maxUsuarios">Usuarios incluidos (cajeros, meseros y cocina)</Label>
          <div className="flex gap-2">
            <Input
              id="maxUsuarios"
              type="number"
              min={0}
              max={100}
              value={maxUsuarios}
              onChange={(event) => setMaxUsuarios(Number(event.target.value))}
            />
            <Button
              variant="outline"
              onClick={handleSaveLimit}
              disabled={saving || maxUsuarios === organization.max_usuarios}
            >
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
