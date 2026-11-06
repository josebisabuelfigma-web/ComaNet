"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChefHat, MapPin, MessageCircle, Minus, Pencil, Phone, Plus, Store, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  addDeliveryItem,
  cancelOrder,
  changeDeliveryItemQuantity,
  dispatchOrder,
  sendOrderToKitchen,
  updateDeliveryInfo,
  updateDeliveryItemNotes,
} from "@/lib/actions/pedidos";
import { formatDateTime, formatMoney, whatsappLink } from "@/lib/format";
import { unavailableProductIds } from "@/lib/combos";
import type { MenuCategory, MenuComboItem, MenuProduct, Order, OrderItem } from "@/lib/supabase/types";

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "success" | "danger" | "muted" }> = {
  pendiente: { label: "Pendiente", variant: "default" },
  despachado: { label: "Despachado", variant: "success" },
  cancelado: { label: "Cancelado", variant: "danger" },
};

export interface OrderCardMenu {
  categories: MenuCategory[];
  products: MenuProduct[];
  comboItems: MenuComboItem[];
  /** Valor de domicilio de Ajustes, para sugerirlo al cambiar a domicilio. */
  defaultDeliveryFee: number;
}

export function OrderCard({
  order,
  items,
  currency,
  kitchenEnabled = false,
  menu,
}: {
  order: Order;
  items: OrderItem[];
  currency: string;
  kitchenEnabled?: boolean;
  menu?: OrderCardMenu;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const badge = STATUS_BADGE[order.status] ?? { label: order.status, variant: "muted" as const };
  const pending = order.status === "pendiente";

  const unsent = items.filter((i) => !i.sent_to_kitchen_at).length;
  const firstSend = !items.some((i) => i.sent_to_kitchen_at);
  const kitchenBadge: { label: string; variant: "default" | "success" | "muted" } = firstSend
    ? { label: "Sin enviar a cocina", variant: "muted" }
    : unsent > 0
      ? { label: "Productos nuevos sin enviar a cocina", variant: "default" }
      : order.kitchen_done_at
        ? { label: "Listo en cocina (aún no despachado)", variant: "success" }
        : { label: "En cocina", variant: "default" };
  const missingAddress = order.fulfillment !== "recoger" && !order.address;
  const whatsapp = whatsappLink(
    order.customer_phone,
    `Hola ${order.customer_name ?? ""}, recibimos tu pedido. Antes de enviarlo a preparar, ¿quieres hacer algún cambio?`
  );

  async function run(action: () => Promise<{ error?: string } | void>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result?.error) {
      setError(result.error);
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <Card className={pending ? "border-brand" : undefined}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-semibold text-brand-ink">Pedido #{order.order_number}</p>
            <Badge variant={badge.variant}>{badge.label}</Badge>
            <Badge variant="outline">{order.fulfillment === "recoger" ? "Recoger" : "Domicilio"}</Badge>
            {kitchenEnabled && pending && (
              <Badge variant={kitchenBadge.variant}>{kitchenBadge.label}</Badge>
            )}
          </div>
          <p className="text-sm text-brand-muted">{formatDateTime(order.created_at)}</p>
        </div>

        <div className="grid gap-1 text-sm text-brand-ink">
          <p className="font-medium">{order.customer_name}</p>
          {order.customer_phone &&
            (whatsapp ? (
              <a
                href={whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-fit items-center gap-1.5 font-medium text-brand-success hover:underline"
                title="Escribirle por WhatsApp"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                {order.customer_phone}
                <span className="text-xs font-normal text-brand-muted">· abrir WhatsApp</span>
              </a>
            ) : (
              <p className="flex items-center gap-1.5 text-brand-muted">
                <Phone className="h-3.5 w-3.5" />
                {order.customer_phone}
              </p>
            ))}
          {order.fulfillment === "recoger" ? (
            <p className="flex items-center gap-1.5 font-medium text-brand-dark">
              <Store className="h-3.5 w-3.5" />
              Recoge en el local
            </p>
          ) : (
            <p className={`flex items-center gap-1.5 ${missingAddress ? "font-medium text-brand-danger" : "text-brand-muted"}`}>
              <MapPin className="h-3.5 w-3.5" />
              {order.address || "Falta la dirección: pídesela al cliente y complétala en Editar pedido"}
            </p>
          )}
        </div>

        <ul className="flex flex-col gap-1 rounded-[var(--radius-brand-sm)] bg-black/[0.03] p-3 text-sm">
          {items.map((item) =>
            editing && pending ? (
              <EditableLine
                key={item.id}
                item={item}
                currency={currency}
                disabled={busy}
                kitchenEnabled={kitchenEnabled}
                onQuantity={(q) => run(() => changeDeliveryItemQuantity(order.id, item.id, q))}
                onNotes={(notes) => run(() => updateDeliveryItemNotes(item.id, notes))}
              />
            ) : (
              <li key={item.id}>
                <div className="flex justify-between gap-2">
                  <span>
                    {item.quantity} × {item.product_name}{" "}
                    {kitchenEnabled && pending && !item.sent_to_kitchen_at && <Badge variant="muted">Sin enviar</Badge>}
                  </span>
                  <span className="text-brand-muted">
                    {formatMoney(Number(item.unit_price) * item.quantity, currency)}
                  </span>
                </div>
                {item.combo_snapshot && (
                  <p className="text-xs text-brand-muted">
                    Incluye: {item.combo_snapshot.map((c) => `${c.quantity * item.quantity} ${c.name}`).join(", ")}
                  </p>
                )}
                {item.notes && <p className="text-xs font-medium text-brand-danger">📝 {item.notes}</p>}
              </li>
            )
          )}
        </ul>

        {editing && pending && menu && (
          <EditPanel
            order={order}
            menu={menu}
            busy={busy}
            currency={currency}
            onAdd={(productId) => run(() => addDeliveryItem(order.id, productId, ""))}
            onSaveInfo={(info) => run(() => updateDeliveryInfo(order.id, order.order_number, info))}
            defaultDeliveryFee={menu.defaultDeliveryFee}
          />
        )}

        {order.notes && !editing && <p className="text-sm text-brand-muted">Observaciones: {order.notes}</p>}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="text-sm text-brand-muted">
            <p>Productos: {formatMoney(order.subtotal, currency)}</p>
            {order.fulfillment !== "recoger" && (
              <p>Domicilio: {Number(order.delivery_fee) > 0 ? formatMoney(order.delivery_fee, currency) : "Gratis"}</p>
            )}
            {Number(order.disposables_fee) > 0 && <p>Desechables: {formatMoney(order.disposables_fee, currency)}</p>}
            <p className="mt-1 text-base font-semibold text-brand-ink">
              Total {formatMoney(order.total, currency)} ·{" "}
              <span className="capitalize">{order.payment_method}</span>
            </p>
          </div>

          {pending && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setConfirmCancel(true)}>
                <X className="h-4 w-4" />
                Cancelar
              </Button>
              {menu && (
                <Button variant={editing ? "dark" : "outline"} disabled={busy} onClick={() => setEditing((v) => !v)}>
                  <Pencil className="h-4 w-4" />
                  {editing ? "Terminar edición" : "Editar pedido"}
                </Button>
              )}
              {kitchenEnabled && (
                <Button
                  variant={unsent > 0 ? "default" : "outline"}
                  disabled={busy || unsent === 0}
                  onClick={() => run(() => sendOrderToKitchen(order.id, order.order_number))}
                >
                  <ChefHat className="h-4 w-4" />
                  {unsent === 0
                    ? "Enviado a cocina"
                    : firstSend
                      ? "Enviar a cocina"
                      : `Enviar cambios a cocina (${unsent})`}
                </Button>
              )}
              <Button
                disabled={busy}
                onClick={() => run(() => dispatchOrder(order.id, order.order_number))}
              >
                <Check className="h-4 w-4" />
                Marcar despachado
              </Button>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-brand-danger">{error}</p>}
      </CardContent>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancelar pedido"
        description={`¿Cancelar el pedido #${order.order_number}? No contará en las ventas.`}
        confirmLabel="Sí, cancelar"
        isLoading={busy}
        onConfirm={async () => {
          await run(() => cancelOrder(order.id, order.order_number));
          setConfirmCancel(false);
        }}
      />
    </Card>
  );
}

function EditableLine({
  item,
  currency,
  disabled,
  kitchenEnabled,
  onQuantity,
  onNotes,
}: {
  item: OrderItem;
  currency: string;
  disabled: boolean;
  kitchenEnabled: boolean;
  onQuantity: (quantity: number) => void;
  onNotes: (notes: string) => void;
}) {
  const [notes, setNotes] = React.useState(item.notes ?? "");

  return (
    <li className="flex flex-col gap-1.5 border-b border-brand-border py-2 last:border-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-brand-ink">
            {item.product_name}{" "}
            {kitchenEnabled && !item.sent_to_kitchen_at && <Badge variant="muted">Sin enviar</Badge>}
          </p>
          <p className="text-xs text-brand-muted">{formatMoney(item.unit_price, currency)} c/u</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={disabled}
            onClick={() => onQuantity(item.quantity - 1)}
            aria-label="Quitar uno"
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="w-6 text-center">{item.quantity}</span>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={disabled}
            onClick={() => onQuantity(item.quantity + 1)}
            aria-label="Agregar uno"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <input
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        onBlur={() => notes.trim() !== (item.notes ?? "") && onNotes(notes)}
        maxLength={200}
        placeholder="Comentario (ej: sin cebolla)"
        className="h-8 rounded-[var(--radius-brand-sm)] border border-brand-border px-2 text-xs"
      />
    </li>
  );
}

function EditPanel({
  order,
  menu,
  busy,
  currency,
  onAdd,
  onSaveInfo,
  defaultDeliveryFee,
}: {
  order: Order;
  menu: OrderCardMenu;
  busy: boolean;
  currency: string;
  onAdd: (productId: string) => void;
  onSaveInfo: (info: {
    name: string;
    phone: string;
    address: string;
    notes: string;
    payment: "efectivo" | "transferencia";
    fulfillment: "domicilio" | "recoger";
    deliveryFee: number;
    disposablesFee: number;
  }) => void;
  defaultDeliveryFee: number;
}) {
  const [productId, setProductId] = React.useState("");
  const [name, setName] = React.useState(order.customer_name ?? "");
  const [phone, setPhone] = React.useState(order.customer_phone ?? "");
  const [address, setAddress] = React.useState(order.address ?? "");
  const [notes, setNotes] = React.useState(order.notes ?? "");
  const [payment, setPayment] = React.useState<"efectivo" | "transferencia">(order.payment_method ?? "efectivo");
  const [fulfillment, setFulfillment] = React.useState<"domicilio" | "recoger">(order.fulfillment ?? "domicilio");
  const [deliveryFee, setDeliveryFee] = React.useState(String(Number(order.delivery_fee)));
  const [disposablesFee, setDisposablesFee] = React.useState(String(Number(order.disposables_fee)));
  const blocked = unavailableProductIds(menu.products, menu.comboItems);
  const options = menu.products.filter((p) => !blocked.has(p.id));

  function changeFulfillment(value: "domicilio" | "recoger") {
    setFulfillment(value);
    if (value === "recoger") setDeliveryFee("0");
    else if (Number(deliveryFee) === 0) setDeliveryFee(String(defaultDeliveryFee));
  }

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-brand-sm)] border border-dashed border-brand-border p-3">
      <p className="text-sm font-semibold text-brand-ink">Editar pedido</p>

      <div className="flex flex-wrap gap-2">
        <select
          value={productId}
          onChange={(event) => setProductId(event.target.value)}
          className="h-10 min-w-0 flex-1 rounded-[var(--radius-brand-sm)] border border-brand-border bg-white px-2 text-sm"
          aria-label="Producto a agregar"
        >
          <option value="">Agregar un producto…</option>
          {menu.categories.map((category) => {
            const inCategory = options.filter((p) => p.category_id === category.id);
            if (inCategory.length === 0) return null;
            return (
              <optgroup key={category.id} label={category.name}>
                {inCategory.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} · {formatMoney(product.price, currency)}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
        <Button
          variant="outline"
          disabled={busy || !productId}
          onClick={() => {
            onAdd(productId);
            setProductId("");
          }}
        >
          <Plus className="h-4 w-4" />
          Agregar
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-brand-muted">
          Nombre del cliente
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-brand-muted">
          Teléfono
          <Input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={30} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-brand-muted">
          Tipo de entrega
          <select
            value={fulfillment}
            onChange={(event) => changeFulfillment(event.target.value as "domicilio" | "recoger")}
            className="h-10 rounded-[var(--radius-brand-sm)] border border-brand-border bg-white px-2 text-sm text-brand-ink"
          >
            <option value="domicilio">Domicilio</option>
            <option value="recoger">Recoger en el local</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-brand-muted">
          Medio de pago
          <select
            value={payment}
            onChange={(event) => setPayment(event.target.value as "efectivo" | "transferencia")}
            className="h-10 rounded-[var(--radius-brand-sm)] border border-brand-border bg-white px-2 text-sm text-brand-ink"
          >
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-brand-muted sm:col-span-2">
          Dirección {fulfillment === "domicilio" && !address.trim() && <span className="text-brand-danger">(falta)</span>}
          <Input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            maxLength={250}
            placeholder="Calle, número, barrio y referencias"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-brand-muted">
          Valor del domicilio
          <Input
            type="number"
            min={0}
            step="any"
            value={deliveryFee}
            disabled={fulfillment === "recoger"}
            onChange={(event) => setDeliveryFee(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-brand-muted">
          Desechables
          <Input
            type="number"
            min={0}
            step="any"
            value={disposablesFee}
            onChange={(event) => setDisposablesFee(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-brand-muted sm:col-span-2">
          Observaciones del pedido
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={300} />
        </label>
      </div>
      <Button
        className="w-fit"
        disabled={busy}
        onClick={() =>
          onSaveInfo({
            name,
            phone,
            address,
            notes,
            payment,
            fulfillment,
            deliveryFee: Number(deliveryFee || 0),
            disposablesFee: Number(disposablesFee || 0),
          })
        }
      >
        Guardar datos del pedido
      </Button>
    </div>
  );
}
