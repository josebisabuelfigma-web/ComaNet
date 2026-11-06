"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChefHat, Minus, Plus, Printer, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PaymentDialog } from "@/components/cobros/payment-dialog";
import {
  addTableItem,
  cancelTablePaymentRequest,
  changeTableItemQuantity,
  closeTable,
  openTable,
  requestTablePayment,
  sendTableToKitchen,
  updateTableItemNotes,
} from "@/lib/actions/mesas";
import { cancelOrder } from "@/lib/actions/pedidos";
import { formatMoney } from "@/lib/format";
import { comboContents, unavailableProductIds } from "@/lib/combos";
import type {
  MenuCategory,
  MenuComboItem,
  MenuProduct,
  Order,
  OrderItem,
  PaymentMethod,
  RestaurantTable,
} from "@/lib/supabase/types";

interface TableOrderProps {
  table: RestaurantTable;
  order: Order | null;
  items: OrderItem[];
  categories: MenuCategory[];
  products: MenuProduct[];
  comboItems: MenuComboItem[];
  currency: string;
  canCancel: boolean;
  /** Caja y administrador: confirman el pago y liberan la mesa. */
  canClose: boolean;
  /** El módulo de cocina está activo: se puede enviar el pedido a cocina. */
  kitchenEnabled: boolean;
}

export function TableOrder({
  table,
  order,
  items,
  categories,
  products,
  comboItems,
  currency,
  canCancel,
  canClose,
  kitchenEnabled,
}: TableOrderProps) {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = React.useState<string | null>(categories[0]?.id ?? null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [paying, setPaying] = React.useState(false);
  const [collecting, setCollecting] = React.useState(false);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const total = items.reduce((sum, item) => sum + Number(item.unit_price) * item.quantity, 0);
  const visibleProducts = products.filter((p) => p.category_id === activeCategory);
  const blocked = unavailableProductIds(products, comboItems);

  async function run(action: () => Promise<{ error?: string } | void>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result?.error) setError(result.error);
    router.refresh();
    return result;
  }

  const unsentCount = items.filter((i) => !i.sent_to_kitchen_at).length;
  const alreadySent = items.some((i) => i.sent_to_kitchen_at);

  async function handleAdd(product: MenuProduct) {
    if (!order) return;
    setNotice(null);
    const result = await run(() => addTableItem(order.id, table.id, product.id, ""));
    if (!result?.error) {
      setNotice(
        kitchenEnabled
          ? `Agregado: ${product.name}. Queda "Sin enviar" hasta que pulses el botón de cocina.`
          : `Agregado: ${product.name}`
      );
    }
  }
  const paymentRequested = !!order?.payment_requested_at;

  async function handleCollect(payment: PaymentMethod, cashReceived: number | null) {
    if (!order) return;
    const result = await closeTable(order.id, payment, cashReceived);
    if (result?.error) return result;
    router.push("/dashboard/mesas");
    router.refresh();
  }

  async function handleRequestPayment(payment: PaymentMethod) {
    if (!order) return;
    const result = await run(() => requestTablePayment(order.id, payment));
    if (!result?.error) {
      setPaying(false);
      router.push("/dashboard/mesas");
    }
  }

  async function handleCancel() {
    if (!order) return;
    const result = await run(() => cancelOrder(order.id, order.order_number));
    setConfirmCancel(false);
    if (!result?.error) router.push("/dashboard/mesas");
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <Link
            href="/dashboard/mesas"
            className="mb-1 inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            Mesas
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-brand-ink">
            {table.name}
            <Badge variant={order ? "default" : "success"}>{order ? "Ocupada" : "Libre"}</Badge>
            {paymentRequested && <Badge variant="danger">Por cobrar</Badge>}
          </h1>
        </div>
      </div>

      {!order ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
            <p className="text-brand-muted">Esta mesa está libre.</p>
            <Button size="lg" disabled={busy} onClick={() => run(() => openTable(table.id))}>
              Abrir mesa y tomar pedido
            </Button>
            {error && <p className="text-sm text-brand-danger">{error}</p>}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Carta */}
          <div className="flex flex-col gap-3 lg:col-span-2 print:hidden">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setActiveCategory(category.id)}
                  className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium ${
                    activeCategory === category.id
                      ? "bg-brand text-brand-ink"
                      : "bg-white text-brand-muted hover:bg-black/5"
                  }`}
                >
                  {category.name}
                </button>
              ))}
            </div>

            {kitchenEnabled && alreadySent && (
              <p className="rounded-[var(--radius-brand-sm)] bg-brand/15 px-3 py-2 text-sm text-brand-ink">
                Esta mesa ya se envió a cocina. Puedes seguir agregando productos de la carta o cambiar cantidades:
                cocina recibe el aviso cuando pulses <strong>Enviar cambios a cocina</strong>.
              </p>
            )}
            {notice && <p className="text-sm font-medium text-brand-success">{notice}</p>}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {visibleProducts.length === 0 && (
                <p className="text-sm text-brand-muted">No hay productos en esta categoría.</p>
              )}
              {visibleProducts.map((product) => (
                <button
                  key={product.id}
                  disabled={busy || blocked.has(product.id)}
                  onClick={() => handleAdd(product)}
                  className="flex items-center gap-3 rounded-[var(--radius-brand-md)] bg-white p-3 text-left shadow-sm transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {product.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={product.image_url} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
                  ) : (
                    <div className="h-14 w-14 shrink-0 rounded bg-black/5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-brand-ink">{product.name}</p>
                    <p className="line-clamp-1 text-xs text-brand-muted">
                      {product.is_combo
                        ? `Incluye: ${comboContents(product.id, products, comboItems)}`
                        : product.description}
                    </p>
                    <p className="text-sm font-semibold text-brand-ink">
                      {blocked.has(product.id) ? "Agotado" : formatMoney(product.price, currency)}
                    </p>
                  </div>
                  {!blocked.has(product.id) && <Plus className="h-5 w-5 text-brand-dark" />}
                </button>
              ))}
            </div>
          </div>

          {/* Cuenta */}
          <Card className="h-fit lg:sticky lg:top-4">
            <CardContent className="flex flex-col gap-3 p-4">
              <h2 className="font-semibold text-brand-ink">
                Cuenta {table.name} <span className="text-brand-muted">#{order.order_number}</span>
              </h2>

              {items.length === 0 && <p className="text-sm text-brand-muted">Aún no hay productos.</p>}

              <ul className="flex flex-col divide-y divide-brand-border">
                {items.map((item) => (
                  <CartLine
                    key={item.id}
                    item={item}
                    currency={currency}
                    disabled={busy}
                    kitchenEnabled={kitchenEnabled}
                    onQuantity={(q) => run(() => changeTableItemQuantity(item.id, table.id, q))}
                    onNotes={(notes) => run(() => updateTableItemNotes(item.id, table.id, notes))}
                  />
                ))}
              </ul>

              {kitchenEnabled && (
                <Button
                  size="lg"
                  disabled={busy || unsentCount === 0}
                  onClick={async () => {
                    setNotice(null);
                    const result = await run(() => sendTableToKitchen(order.id, table.id));
                    if (!result?.error) setNotice("Enviado a cocina.");
                  }}
                >
                  <ChefHat className="h-4 w-4" />
                  {unsentCount > 0
                    ? `${alreadySent ? "Enviar cambios a cocina" : "Enviar a cocina"} (${unsentCount} ${unsentCount === 1 ? "producto" : "productos"})`
                    : items.length > 0
                      ? "Todo enviado a cocina"
                      : "Enviar a cocina"}
                </Button>
              )}

              <div className="flex justify-between border-t border-brand-border pt-3 text-lg font-bold text-brand-ink">
                <span>Total</span>
                <span>{formatMoney(total, currency)}</span>
              </div>

              {error && <p className="text-sm text-brand-danger">{error}</p>}

              {paymentRequested ? (
                <div className="flex flex-col gap-2 rounded-[var(--radius-brand-sm)] border border-brand-danger bg-brand-danger/10 p-3">
                  <p className="text-sm font-semibold text-brand-danger">
                    Cuenta entregada (<span className="capitalize">{order.payment_requested_method}</span>). La mesa
                    sigue ocupada hasta que caja reciba el pago.
                  </p>
                  {canClose ? (
                    <Button disabled={busy} onClick={() => setCollecting(true)}>
                      Cobrar y liberar mesa
                    </Button>
                  ) : (
                    <p className="text-sm text-brand-muted">Caja la verá en Mesas por cobrar.</p>
                  )}
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => run(() => cancelTablePaymentRequest(order.id))}
                  >
                    Retirar aviso y seguir editando
                  </Button>
                </div>
              ) : paying ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-brand-ink">¿Cómo va a pagar el cliente?</p>
                  <Button disabled={busy} onClick={() => handleRequestPayment("efectivo")}>
                    Efectivo
                  </Button>
                  <Button disabled={busy} variant="dark" onClick={() => handleRequestPayment("transferencia")}>
                    Transferencia
                  </Button>
                  <p className="text-xs text-brand-muted">
                    La mesa sigue ocupada hasta que caja reciba el pago.
                  </p>
                  <Button variant="ghost" onClick={() => setPaying(false)}>
                    Volver
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {canClose ? (
                    <Button disabled={busy || items.length === 0} onClick={() => setCollecting(true)}>
                      Cobrar cuenta
                    </Button>
                  ) : (
                    <Button disabled={busy || items.length === 0} onClick={() => setPaying(true)}>
                      Cuenta entregada
                    </Button>
                  )}
                  <Button variant="outline" disabled={items.length === 0} onClick={() => window.print()}>
                    <Printer className="h-4 w-4" />
                    Imprimir cuenta
                  </Button>
                  {canCancel && (
                    <Button variant="ghost" disabled={busy} onClick={() => setConfirmCancel(true)}>
                      <Trash2 className="h-4 w-4 text-brand-danger" />
                      Cancelar cuenta
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {order && canClose && (
        <PaymentDialog
          open={collecting}
          onOpenChange={setCollecting}
          title={`Cobrar ${table.name}`}
          total={total}
          currency={currency}
          defaultMethod={order.payment_requested_method}
          onConfirm={handleCollect}
        />
      )}

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancelar cuenta"
        description={`¿Cancelar la cuenta de ${table.name}? No contará en las ventas.`}
        confirmLabel="Sí, cancelar"
        isLoading={busy}
        onConfirm={handleCancel}
      />
    </div>
  );
}

function CartLine({
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
    <li className="flex flex-col gap-1.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-brand-ink">
            {item.product_name}{" "}
            {kitchenEnabled &&
              (!item.sent_to_kitchen_at ? (
                <Badge variant="muted">Sin enviar</Badge>
              ) : item.kitchen_status === "listo" ? (
                <Badge variant="success">Despachado</Badge>
              ) : (
                <Badge>En cocina</Badge>
              ))}
          </p>
          {item.combo_snapshot && (
            <p className="text-xs text-brand-muted">
              Incluye: {item.combo_snapshot.map((c) => `${c.quantity * item.quantity} ${c.name}`).join(", ")}
            </p>
          )}
          <p className="text-xs text-brand-muted">{formatMoney(item.unit_price, currency)} c/u</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={disabled}
            onClick={() => onQuantity(item.quantity - 1)}
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="w-6 text-center text-sm">{item.quantity}</span>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={disabled}
            onClick={() => onQuantity(item.quantity + 1)}
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
        className="h-8 rounded-[var(--radius-brand-sm)] border border-brand-border px-2 text-xs print:border-0"
      />
    </li>
  );
}
