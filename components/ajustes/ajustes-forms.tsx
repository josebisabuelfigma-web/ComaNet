"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ImagePicker } from "@/components/image-picker";
import { DAY_LABELS } from "@/lib/schedule";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createTable,
  deleteTable,
  saveBusinessInfo,
  saveSettings,
  setOrdersOpen,
} from "@/lib/actions/ajustes";
import type { Organization, RestaurantSettings, RestaurantTable } from "@/lib/supabase/types";

export function PublicLinkCard({
  slug,
  ordersOpen,
  menuEnabled,
}: {
  slug: string;
  ordersOpen: boolean;
  menuEnabled: boolean;
}) {
  const router = useRouter();
  const [copied, setCopied] = React.useState(false);
  const [toggling, setToggling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [url, setUrl] = React.useState(`/m/${slug}`);

  React.useEffect(() => {
    setUrl(`${window.location.origin}/m/${slug}`);
  }, [slug]);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function toggle(open: boolean) {
    setToggling(true);
    setError(null);
    const result = await setOrdersOpen(open);
    setToggling(false);
    if (result?.error) setError(result.error);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tu carta en línea</CardTitle>
        <CardDescription>
          Comparte este enlace con tus clientes (redes, WhatsApp, código QR).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!menuEnabled && (
          <p className="rounded-[var(--radius-brand-sm)] bg-brand/15 px-3 py-2 text-sm text-brand-ink">
            El módulo &quot;Menú en línea y domicilios&quot; no está activo para tu negocio, así que
            la carta pública aún no está disponible. Contáctanos para activarlo.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <code className="flex-1 truncate rounded-[var(--radius-brand-sm)] bg-black/5 px-3 py-2 text-sm">
            {url}
          </code>
          <Button variant="outline" onClick={copy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copiado" : "Copiar"}
          </Button>
          <a href={`/m/${slug}`} target="_blank" rel="noopener noreferrer">
            <Button variant="outline">
              <ExternalLink className="h-4 w-4" />
              Abrir
            </Button>
          </a>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-brand-ink">Recibiendo pedidos</p>
            <p className="text-sm text-brand-muted">
              Apágalo para pausar los pedidos en línea (la carta se sigue viendo).
            </p>
          </div>
          <Switch checked={ordersOpen} disabled={toggling} onCheckedChange={toggle} />
        </div>
        {error && <p className="text-sm text-brand-danger">{error}</p>}
      </CardContent>
    </Card>
  );
}

export function SettingsForm({ settings }: { settings: RestaurantSettings }) {
  const [state, formAction, pending] = useActionState(saveSettings, undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pedidos, domicilio y pagos</CardTitle>
        <CardDescription>
          Estos datos los ve el cliente al hacer su pedido y definen el valor total.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="whatsappNumber">WhatsApp que recibe los pedidos</Label>
            <Input
              id="whatsappNumber"
              name="whatsappNumber"
              defaultValue={settings.whatsapp_number ?? ""}
              placeholder="573001234567 (con indicativo del país)"
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="welcomeMessage">Mensaje de bienvenida (opcional)</Label>
            <Input
              id="welcomeMessage"
              name="welcomeMessage"
              defaultValue={settings.welcome_message ?? ""}
              placeholder="Ej: Abrimos de 5pm a 11pm"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deliveryFee">Valor del domicilio</Label>
            <Input
              id="deliveryFee"
              name="deliveryFee"
              type="number"
              min={0}
              step={100}
              defaultValue={settings.delivery_fee}
            />
            <p className="text-xs text-brand-muted">Déjalo en 0 si el domicilio es gratis.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deliveryMessage">Mensaje del domicilio</Label>
            <Input
              id="deliveryMessage"
              name="deliveryMessage"
              defaultValue={settings.delivery_message ?? ""}
              placeholder="Ej: Domicilio gratis en el sector"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="disposablesFee">Valor adicional (desechables)</Label>
            <Input
              id="disposablesFee"
              name="disposablesFee"
              type="number"
              min={0}
              step={100}
              defaultValue={settings.disposables_fee}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="disposablesLabel">Nombre del cargo adicional</Label>
            <Input
              id="disposablesLabel"
              name="disposablesLabel"
              defaultValue={settings.disposables_label}
            />
          </div>

          <div className="flex flex-col gap-3 rounded-[var(--radius-brand-md)] border border-brand-border p-3 sm:col-span-2">
            <div>
              <p className="text-sm font-medium text-brand-ink">Horario de atención</p>
              <p className="text-xs text-brand-muted">
                Fuera de este horario la carta sigue recibiendo pedidos, pero avisa al cliente que
                se gestionarán cuando abras. Déjalo vacío si no manejas horario. Hora de Colombia.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="opensAt">Abre</Label>
                <Input id="opensAt" name="opensAt" type="time" defaultValue={settings.opens_at?.slice(0, 5) ?? ""} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="closesAt">Cierra</Label>
                <Input id="closesAt" name="closesAt" type="time" defaultValue={settings.closes_at?.slice(0, 5) ?? ""} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {DAY_LABELS.map((label, day) => (
                <label
                  key={day}
                  className="flex items-center gap-1.5 rounded-full border border-brand-border px-3 py-1 text-sm"
                >
                  <input
                    type="checkbox"
                    name="openDays"
                    value={day}
                    defaultChecked={(settings.open_days ?? [0, 1, 2, 3, 4, 5, 6]).includes(day)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="pickupEnabled" defaultChecked={settings.pickup_enabled} />
            Permitir que el cliente recoja el pedido en el local (usa la dirección de &quot;Datos del negocio&quot;)
          </label>

          <div className="flex flex-col gap-2 sm:col-span-2">
            <p className="text-sm font-medium text-brand-ink">Medios de pago que aceptas</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="acceptsCash" defaultChecked={settings.accepts_cash} />
              Efectivo
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="acceptsTransfer" defaultChecked={settings.accepts_transfer} />
              Transferencia
            </label>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="transferInstructions">Datos para transferencia</Label>
            <Input
              id="transferInstructions"
              name="transferInstructions"
              defaultValue={settings.transfer_instructions ?? ""}
              placeholder="Ej: Nequi 300 123 4567 a nombre de Carlos"
            />
          </div>

          {state?.error && <p className="text-sm text-brand-danger sm:col-span-2">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-success sm:col-span-2">{state.success}</p>}

          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? "Guardando..." : "Guardar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function BusinessInfoForm({ organization }: { organization: Organization }) {
  const [state, formAction, pending] = useActionState(saveBusinessInfo, undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos del negocio y logo</CardTitle>
        <CardDescription>El logo se ve dentro del sistema y en la carta de tus clientes.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="legalName">Razón social</Label>
            <Input id="legalName" name="legalName" defaultValue={organization.legal_name ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="taxId">NIT / documento</Label>
            <Input id="taxId" name="taxId" defaultValue={organization.tax_id ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="billingPhone">Teléfono</Label>
            <Input id="billingPhone" name="billingPhone" defaultValue={organization.billing_phone ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="billingAddress">Dirección</Label>
            <Input id="billingAddress" name="billingAddress" defaultValue={organization.billing_address ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="ticketFooter">Mensaje al pie de los comprobantes</Label>
            <Input id="ticketFooter" name="ticketFooter" defaultValue={organization.ticket_footer ?? ""} />
          </div>
          <div className="sm:col-span-2">
            <ImagePicker name="logo" currentUrl={organization.logo_url} removeName="removeLogoUnused" label="Logo" />
          </div>

          {state?.error && <p className="text-sm text-brand-danger sm:col-span-2">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-success sm:col-span-2">{state.success}</p>}

          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? "Guardando..." : "Guardar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function TablesManager({ tables }: { tables: RestaurantTable[] }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await createTable(name);
    setBusy(false);
    if (result?.error) return setError(result.error);
    setName("");
    router.refresh();
  }

  async function addMany() {
    setBusy(true);
    setError(null);
    const start = tables.length + 1;
    for (let i = 0; i < 5; i++) {
      const result = await createTable(`Mesa ${start + i}`);
      if (result?.error) {
        setError(result.error);
        break;
      }
    }
    setBusy(false);
    router.refresh();
  }

  async function remove(table: RestaurantTable) {
    setError(null);
    const result = await deleteTable(table.id, table.name);
    if (result?.error) return setError(result.error);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mesas del local</CardTitle>
        <CardDescription>Las mesas que los meseros verán para tomar pedidos.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ej: Mesa 1, Barra, Terraza 2"
            className="max-w-xs"
            required
          />
          <Button type="submit" disabled={busy}>
            <Plus className="h-4 w-4" />
            Agregar
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={addMany}>
            Agregar 5 mesas
          </Button>
        </form>
        {error && <p className="text-sm text-brand-danger">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {tables.length === 0 && <p className="text-sm text-brand-muted">Aún no hay mesas.</p>}
          {tables.map((table) => (
            <span
              key={table.id}
              className="inline-flex items-center gap-2 rounded-full border border-brand-border bg-white px-3 py-1 text-sm"
            >
              {table.name}
              <button onClick={() => remove(table)} aria-label={`Eliminar ${table.name}`}>
                <Trash2 className="h-3.5 w-3.5 text-brand-danger" />
              </button>
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
