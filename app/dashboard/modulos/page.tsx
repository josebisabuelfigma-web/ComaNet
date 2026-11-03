import { Lock, Unlock } from "lucide-react";

import { requireProfile } from "@/lib/auth";
import { getModulesWithStatus } from "@/lib/modules";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const currency = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

const CORE_MODULES = [
  { name: "Carta y productos", description: "Categorías, productos, precios, ingredientes y disponibilidad." },
  { name: "Ajustes y personal", description: "WhatsApp, domicilio, medios de pago, mesas y usuarios." },
];

export default async function ModulosPage() {
  const profile = await requireProfile();
  const modules = profile.organization_id
    ? await getModulesWithStatus(profile.organization_id)
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-ink">Módulos</h1>
        <p className="text-sm text-brand-muted">
          Estos son los módulos disponibles para tu negocio. Para activar uno
          nuevo, contáctanos.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CORE_MODULES.map((mod) => (
          <Card key={mod.name}>
            <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle>{mod.name}</CardTitle>
              <Unlock className="h-5 w-5 text-brand-success" />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-brand-muted">{mod.description}</p>
              <Badge variant="success">Incluido</Badge>
            </CardContent>
          </Card>
        ))}

        {modules.map((mod) => (
          <Card key={mod.id} className={mod.enabled ? "" : "opacity-80"}>
            <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle>{mod.name}</CardTitle>
              {mod.enabled ? (
                <Unlock className="h-5 w-5 text-brand-success" />
              ) : (
                <Lock className="h-5 w-5 text-brand-muted" />
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-brand-muted">{mod.description}</p>
              <div className="flex items-center justify-between">
                <Badge variant={mod.enabled ? "success" : "muted"}>
                  {mod.enabled ? "Activo" : "Bloqueado"}
                </Badge>
                {mod.price > 0 && (
                  <span className="text-sm font-medium text-brand-ink">
                    {currency.format(mod.price)}/mes
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
