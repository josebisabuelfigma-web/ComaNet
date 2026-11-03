"use client";

import * as React from "react";
import { ArrowLeft, ArrowUp, Check, ChevronRight, Loader2, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandFooter } from "@/components/brand-footer";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { createClient } from "@/lib/supabase/client";
import { createPublicOrder } from "@/lib/actions/public";
import { formatMoney } from "@/lib/format";
import { isWithinSchedule, scheduleLabel } from "@/lib/schedule";
import type {
  MenuCategory,
  MenuComboItem,
  MenuProduct,
  Organization,
  Fulfillment,
  PaymentMethod,
  RestaurantSettings,
} from "@/lib/supabase/types";
import { comboContents, unavailableProductIds } from "@/lib/combos";

interface PublicMenuProps {
  slug: string;
  organization: Pick<Organization, "id" | "name" | "logo_url" | "currency" | "billing_address">;
  initialSettings: RestaurantSettings;
  initialCategories: MenuCategory[];
  initialProducts: MenuProduct[];
  initialComboItems: MenuComboItem[];
}

type CartLine = { id: string; productId: string; quantity: number; notes: string };

type Confirmation = {
  orderNumber: number;
  total: number;
  whatsappUrl: string | null;
  outsideHours?: boolean;
};

export function PublicMenu({
  slug,
  organization,
  initialSettings,
  initialCategories,
  initialProducts,
  initialComboItems,
}: PublicMenuProps) {
  const money = (n: number) => formatMoney(n, organization.currency);
  const storageKey = `comanet-cart-${slug}`;

  const [categories, setCategories] = React.useState(initialCategories);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  // null = inicio con todas las categorías; si no, el id de la categoría abierta.
  const [activeCategoryId, setActiveCategoryId] = React.useState<string | null>(null);
  const [showTop, setShowTop] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function openCategory(id: string | null) {
    setActiveCategoryId(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  // Se reevalúa cada minuto para que el aviso aparezca/desaparezca solo.
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const [products, setProducts] = React.useState(initialProducts);
  const [comboItems, setComboItems] = React.useState(initialComboItems);
  const [fulfillment, setFulfillment] = React.useState<Fulfillment>("domicilio");
  const [settings, setSettings] = React.useState(initialSettings);
  const [cart, setCart] = React.useState<CartLine[]>([]);
  const [cartLoaded, setCartLoaded] = React.useState(false);
  const [cartOpen, setCartOpen] = React.useState(false);
  const [customer, setCustomer] = React.useState({ name: "", phone: "", address: "", notes: "" });
  const [payment, setPayment] = React.useState<PaymentMethod | "">("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmation, setConfirmation] = React.useState<Confirmation | null>(null);

  // --- Carrito persistente en el navegador -------------------------------
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.cart) setCart(parsed.cart);
        if (parsed.customer) setCustomer(parsed.customer);
      }
    } catch {
      // datos corruptos: se ignoran
    }
    setCartLoaded(true);
  }, [storageKey]);

  React.useEffect(() => {
    if (!cartLoaded) return;
    localStorage.setItem(storageKey, JSON.stringify({ cart, customer }));
  }, [cart, customer, cartLoaded, storageKey]);

  // --- Disponibilidad y ajustes en tiempo real ---------------------------
  React.useEffect(() => {
    const supabase = createClient();

    async function refetch() {
      const [{ data: freshCategories }, { data: freshProducts }, { data: freshCombos }, { data: freshSettings }] = await Promise.all([
        supabase
          .from("menu_categories")
          .select("*")
          .eq("organization_id", organization.id)
          .order("sort_order")
          .order("created_at"),
        supabase
          .from("menu_products")
          .select("*")
          .eq("organization_id", organization.id)
          .eq("is_active", true)
          .order("sort_order")
          .order("created_at"),
        supabase.from("menu_combo_items").select("*").eq("organization_id", organization.id),
        supabase
          .from("restaurant_settings")
          .select("*")
          .eq("organization_id", organization.id)
          .maybeSingle(),
      ]);
      if (freshCategories) setCategories(freshCategories as MenuCategory[]);
      if (freshProducts) setProducts(freshProducts as MenuProduct[]);
      if (freshCombos) setComboItems(freshCombos as MenuComboItem[]);
      if (freshSettings) setSettings(freshSettings as RestaurantSettings);
    }

    const channel = supabase
      .channel(`public-menu-${organization.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "menu_products", filter: `organization_id=eq.${organization.id}` },
        refetch
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "menu_combo_items", filter: `organization_id=eq.${organization.id}` },
        refetch
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "menu_categories", filter: `organization_id=eq.${organization.id}` },
        refetch
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "restaurant_settings",
          filter: `organization_id=eq.${organization.id}`,
        },
        refetch
      )
      .subscribe();

    // Respaldo si la conexión en vivo se interrumpe.
    const interval = setInterval(refetch, 30_000);
    const onVisible = () => document.visibilityState === "visible" && refetch();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [organization.id]);

  const productById = React.useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const blocked = React.useMemo(() => unavailableProductIds(products, comboItems), [products, comboItems]);

  const visibleCategories = React.useMemo(
    () => categories.filter((c) => products.some((p) => p.category_id === c.id)),
    [categories, products]
  );
  // Si la categoría abierta desaparece (la ocultaron), se vuelve al inicio.
  const activeCategory = visibleCategories.find((c) => c.id === activeCategoryId) ?? null;

  // Líneas del carrito con su producto vigente (puede haberse agotado/ocultado).
  const lines = cart.map((line) => {
    const product = productById.get(line.productId);
    return { line, product, unavailable: !product || blocked.has(product.id) };
  });
  const hasUnavailable = lines.some((l) => l.unavailable);
  const subtotal = lines.reduce(
    (sum, l) => (l.product ? sum + Number(l.product.price) * l.line.quantity : sum),
    0
  );
  const pickupAllowed = settings.pickup_enabled;
  const effectiveFulfillment: Fulfillment = pickupAllowed ? fulfillment : "domicilio";
  const deliveryFee = effectiveFulfillment === "domicilio" ? Number(settings.delivery_fee) : 0;
  const disposablesFee = Number(settings.disposables_fee);
  const total = subtotal + deliveryFee + disposablesFee;
  const itemCount = cart.reduce((sum, l) => sum + l.quantity, 0);

  const paymentOptions: { value: PaymentMethod; label: string }[] = [];
  if (settings.accepts_cash) paymentOptions.push({ value: "efectivo", label: "Efectivo" });
  if (settings.accepts_transfer) paymentOptions.push({ value: "transferencia", label: "Transferencia" });

  function addProduct(product: MenuProduct) {
    setCart((current) => {
      const existing = current.find((l) => l.productId === product.id && l.notes === "");
      if (existing) {
        return current.map((l) =>
          l.id === existing.id ? { ...l, quantity: Math.min(l.quantity + 1, 50) } : l
        );
      }
      return [...current, { id: crypto.randomUUID(), productId: product.id, quantity: 1, notes: "" }];
    });
  }

  function updateLine(id: string, patch: Partial<CartLine>) {
    setCart((current) =>
      current.flatMap((l) => {
        if (l.id !== id) return [l];
        const next = { ...l, ...patch };
        return next.quantity <= 0 ? [] : [{ ...next, quantity: Math.min(next.quantity, 50) }];
      })
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!payment) return setError("Selecciona el medio de pago");
    if (hasUnavailable) return setError("Quita del carrito los productos agotados");

    setSending(true);
    const result = await createPublicOrder({
      orgId: organization.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      fulfillment: effectiveFulfillment,
      address: effectiveFulfillment === "domicilio" ? customer.address : "",
      notes: customer.notes,
      payment,
      items: cart.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        notes: l.notes.trim() || undefined,
      })),
    });
    setSending(false);

    if ("error" in result) return setError(result.error);

    setCart([]);
    setCartOpen(false);
    setConfirmation({ ...result, outsideHours });
    if (result.whatsappUrl) window.location.assign(result.whatsappUrl);
  }

  const ordersClosed = !settings.orders_open;
  const outsideHours = !isWithinSchedule(settings, now);

  // --- Pantalla de confirmación -----------------------------------------
  if (confirmation) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-[var(--radius-brand-lg)] bg-white p-8 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-success/15">
            <Check className="h-7 w-7 text-brand-success" />
          </div>
          <h1 className="text-xl font-semibold text-brand-ink">
            ¡Pedido #{confirmation.orderNumber} registrado!
          </h1>
          <p className="mt-1 text-brand-muted">Total a pagar: {money(confirmation.total)}</p>
          {confirmation.outsideHours && (
            <p className="mt-3 rounded-[var(--radius-brand-sm)] bg-brand/10 px-3 py-2 text-sm text-brand-ink">
              🕒 Estás pidiendo fuera de horario: tu pedido se gestionará en cuanto entremos en operación.
            </p>
          )}
          {confirmation.whatsappUrl ? (
            <>
              <p className="mt-4 text-sm text-brand-muted">
                Se abrió WhatsApp con el detalle de tu pedido. Envía el mensaje para que lo
                preparemos.
              </p>
              <a href={confirmation.whatsappUrl}>
                <Button className="mt-4 w-full bg-[#25D366] text-white hover:bg-[#1fb857]">
                  Abrir WhatsApp de nuevo
                </Button>
              </a>
            </>
          ) : (
            <p className="mt-4 text-sm text-brand-muted">
              Recibimos tu pedido. Pronto nos comunicaremos contigo.
            </p>
          )}
          <Button variant="outline" className="mt-3 w-full" onClick={() => setConfirmation(null)}>
            Volver a la carta
          </Button>
          <BrandFooter className="mt-2" />
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-28">
      <header className="bg-brand-ink text-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={organization.logo_url ?? "/brand/logo.svg"}
            alt={organization.name}
            className="h-14 w-14 rounded-[var(--radius-brand-md)] bg-white/10 object-contain"
          />
          <div>
            <h1 className="text-xl font-semibold">{organization.name}</h1>
            {settings.welcome_message && <p className="text-sm text-white/70">{settings.welcome_message}</p>}
          </div>
        </div>
      </header>
      {visibleCategories.length > 0 && (
        <div className="sticky top-0 z-20 bg-brand-ink text-white shadow-md">
          <nav className="mx-auto flex max-w-3xl gap-2 overflow-x-auto px-4 py-3">
            <button
              type="button"
              onClick={() => openCategory(null)}
              className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm ${
                activeCategoryId === null ? "bg-brand font-semibold text-brand-ink" : "bg-white/10 hover:bg-white/20"
              }`}
            >
              Inicio
            </button>
            {visibleCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => openCategory(category.id)}
                className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm ${
                  activeCategoryId === category.id
                    ? "bg-brand font-semibold text-brand-ink"
                    : "bg-white/10 hover:bg-white/20"
                }`}
              >
                {category.name}
              </button>
            ))}
          </nav>
        </div>
      )}

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
        {outsideHours && !ordersClosed && (
          <div className="rounded-[var(--radius-brand-md)] border border-brand bg-brand/10 px-4 py-3 text-sm text-brand-ink">
            <p className="font-semibold">🕒 Estamos fuera de horario</p>
            <p>Tu pedido se gestionará en cuanto entremos en operación.</p>
            {scheduleLabel(settings) && <p className="mt-0.5 text-xs text-brand-muted">Nuestro horario: {scheduleLabel(settings)}</p>}
          </div>
        )}

        {ordersClosed && (
          <p className="rounded-[var(--radius-brand-md)] bg-brand-danger/10 px-4 py-3 text-sm text-brand-danger">
            Por ahora no estamos recibiendo pedidos. Puedes ver la carta, pero no podrás hacer pedidos.
          </p>
        )}

        {(settings.delivery_message || Number(settings.delivery_fee) > 0) && (
          <p className="rounded-[var(--radius-brand-md)] bg-brand/15 px-4 py-3 text-sm text-brand-ink">
            🛵 {settings.delivery_message || `Domicilio: ${money(Number(settings.delivery_fee))}`}
          </p>
        )}

        {activeCategory === null ? (
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {visibleCategories.map((category) => {
              const items = products.filter((p) => p.category_id === category.id);
              const cover = items.find((p) => p.image_url)?.image_url;
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => openCategory(category.id)}
                  className="flex items-center gap-3 rounded-[var(--radius-brand-md)] bg-white p-3 text-left shadow-sm transition-shadow hover:shadow-md"
                >
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover} alt="" className="h-20 w-20 shrink-0 rounded-[var(--radius-brand-sm)] object-cover" />
                  ) : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[var(--radius-brand-sm)] bg-brand/15 text-2xl font-bold text-brand-ink">
                      {category.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-lg font-semibold text-brand-ink">{category.name}</p>
                    <p className="text-sm text-brand-muted">
                      {items.length} {items.length === 1 ? "producto" : "productos"}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-brand-muted" />
                </button>
              );
            })}
          </section>
        ) : (
          (() => {
            const category = activeCategory;
            const items = products.filter((p) => p.category_id === category.id);
            return (
              <section>
                <button
                  type="button"
                  onClick={() => openCategory(null)}
                  className="mb-3 flex items-center gap-1.5 rounded-[var(--radius-brand-sm)] px-2 py-1.5 text-sm font-medium text-brand-ink hover:bg-black/5"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Volver al inicio
                </button>
                <h2 className="mb-3 text-lg font-semibold text-brand-ink">{category.name}</h2>
                <div className="flex flex-col gap-3">
                {items.map((product) => {
                  const soldOut = blocked.has(product.id);
                  const inCart = cart
                    .filter((l) => l.productId === product.id)
                    .reduce((sum, l) => sum + l.quantity, 0);
                  return (
                    <article
                      key={product.id}
                      className={`flex gap-3 rounded-[var(--radius-brand-md)] bg-white p-3 shadow-sm ${
                        soldOut ? "opacity-60" : ""
                      }`}
                    >
                      {product.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={product.image_url}
                          alt={product.name}
                          className="h-24 w-24 shrink-0 rounded-[var(--radius-brand-sm)] object-cover"
                        />
                      )}
                      <div className="flex min-w-0 flex-1 flex-col">
                        <h3 className="font-semibold text-brand-ink">{product.name}</h3>
                        {product.is_combo ? (
                          <p className="mt-0.5 text-sm text-brand-muted">
                            Incluye: {comboContents(product.id, products, comboItems)}
                            {product.description ? ` · ${product.description}` : ""}
                          </p>
                        ) : (
                          product.description && (
                            <p className="mt-0.5 text-sm text-brand-muted">{product.description}</p>
                          )
                        )}
                        <div className="mt-auto flex items-center justify-between pt-2">
                          <span className="font-semibold text-brand-ink">{money(Number(product.price))}</span>
                          {soldOut ? (
                            <span className="rounded-full bg-brand-danger/10 px-3 py-1 text-xs font-semibold text-brand-danger">
                              Agotado
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              disabled={ordersClosed}
                              onClick={() => addProduct(product)}
                            >
                              <Plus className="h-4 w-4" />
                              {inCart > 0 ? `Agregar (${inCart})` : "Agregar"}
                            </Button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
                </div>
                <button
                  type="button"
                  onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                  className="mx-auto mt-6 flex items-center gap-1.5 rounded-full border border-brand-border bg-white px-5 py-2 text-sm font-medium text-brand-ink shadow-sm hover:bg-black/5"
                >
                  <ArrowUp className="h-4 w-4" />
                  Arriba
                </button>
              </section>
            );
          })()
        )}

        {products.length === 0 && (
          <p className="py-10 text-center text-brand-muted">La carta aún no tiene productos.</p>
        )}
      </main>

      <BrandFooter />

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancelar pedido"
        description="Se borrarán todos los productos de tu carrito y tus comentarios. Tus datos de contacto se conservan."
        confirmLabel="Sí, borrar todo"
        cancelLabel="No, volver"
        onConfirm={() => {
          setCart([]);
          setCustomer((current) => ({ ...current, notes: "" }));
          setPayment("");
          setError(null);
          setConfirmCancel(false);
          setCartOpen(false);
        }}
      />

      {activeCategory && showTop && !cartOpen && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="Ir arriba"
          className={`fixed right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-brand-ink text-white shadow-lg ${
            itemCount > 0 ? "bottom-24" : "bottom-6"
          }`}
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      )}

      {itemCount > 0 && !cartOpen && (
        <div className="fixed inset-x-0 bottom-0 z-30 p-4">
          <button
            onClick={() => setCartOpen(true)}
            className="mx-auto flex w-full max-w-3xl items-center justify-between rounded-[var(--radius-brand-md)] bg-brand px-5 py-4 font-semibold text-brand-ink shadow-xl"
          >
            <span className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5" />
              Ver carrito ({itemCount})
            </span>
            <span>{money(subtotal)}</span>
          </button>
        </div>
      )}

      {cartOpen && (
        <div className="fixed inset-0 z-50 flex justify-center bg-black/50">
          <div className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-brand-border bg-white px-3 py-3">
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                className="flex items-center gap-1.5 rounded-[var(--radius-brand-sm)] px-2 py-1.5 text-sm font-medium text-brand-ink hover:bg-black/5"
              >
                <ArrowLeft className="h-4 w-4" />
                Seguir agregando
              </button>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => setConfirmCancel(true)}
                  className="flex items-center gap-1.5 rounded-[var(--radius-brand-sm)] px-2 py-1.5 text-sm font-medium text-brand-danger hover:bg-brand-danger/10"
                >
                  <Trash2 className="h-4 w-4" />
                  Cancelar pedido
                </button>
              )}
            </div>

            <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-5 p-4">
              <h2 className="text-xl font-semibold text-brand-ink">Tu pedido</h2>
              {outsideHours && !ordersClosed && (
                <div className="rounded-[var(--radius-brand-md)] border border-brand bg-brand/10 px-4 py-3 text-sm text-brand-ink">
                  <p className="font-semibold">🕒 Estamos fuera de horario</p>
                  <p>Tu pedido se gestionará en cuanto entremos en operación.</p>
                  {scheduleLabel(settings) && (
                    <p className="mt-0.5 text-xs text-brand-muted">Nuestro horario: {scheduleLabel(settings)}</p>
                  )}
                </div>
              )}
              {cart.length === 0 && (
                <p className="rounded-[var(--radius-brand-md)] bg-black/[0.03] p-4 text-center text-sm text-brand-muted">
                  Tu carrito está vacío. Vuelve a la carta para agregar productos.
                </p>
              )}
              <ul className="flex flex-col divide-y divide-brand-border">
                {lines.map(({ line, product, unavailable }) => (
                  <li key={line.id} className="flex flex-col gap-2 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-brand-ink">{product?.name ?? "Producto no disponible"}</p>
                        {unavailable ? (
                          <p className="text-xs font-medium text-brand-danger">
                            Agotado — quítalo para continuar
                          </p>
                        ) : (
                          <p className="text-xs text-brand-muted">
                            {money(Number(product!.price))} c/u ·{" "}
                            <span className="font-medium text-brand-ink">
                              {money(Number(product!.price) * line.quantity)}
                            </span>
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => updateLine(line.id, { quantity: line.quantity - 1 })}
                          aria-label="Quitar uno"
                        >
                          {line.quantity === 1 ? <Trash2 className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                        </Button>
                        <span className="w-6 text-center text-sm">{line.quantity}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          disabled={unavailable}
                          onClick={() => updateLine(line.id, { quantity: line.quantity + 1 })}
                          aria-label="Agregar uno"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <input
                      value={line.notes}
                      onChange={(event) => updateLine(line.id, { notes: event.target.value })}
                      maxLength={200}
                      placeholder="Comentario (ej: sin cebolla)"
                      className="h-9 rounded-[var(--radius-brand-sm)] border border-brand-border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    />
                  </li>
                ))}
              </ul>

              <div className="flex flex-col gap-1 rounded-[var(--radius-brand-md)] bg-black/[0.03] p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-brand-muted">Valor productos</span>
                  <span>{money(subtotal)}</span>
                </div>
                {effectiveFulfillment === "domicilio" && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-brand-muted">Domicilio</span>
                      <span>{deliveryFee > 0 ? money(deliveryFee) : "Gratis"}</span>
                    </div>
                    {settings.delivery_message && (
                      <p className="text-xs text-brand-muted">{settings.delivery_message}</p>
                    )}
                  </>
                )}
                {disposablesFee > 0 && (
                  <div className="flex justify-between">
                    <span className="text-brand-muted">{settings.disposables_label}</span>
                    <span>{money(disposablesFee)}</span>
                  </div>
                )}
                <div className="mt-1 flex justify-between border-t border-brand-border pt-2 text-base font-bold text-brand-ink">
                  <span>Total</span>
                  <span>{money(total)}</span>
                </div>
              </div>

              {pickupAllowed && (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium text-brand-ink">¿Cómo quieres tu pedido?</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { value: "domicilio", label: "🛵 Domicilio" },
                        { value: "recoger", label: "🛍️ Recoger en el local" },
                      ] as { value: Fulfillment; label: string }[]
                    ).map((option) => (
                      <label
                        key={option.value}
                        className={`flex cursor-pointer items-center justify-center rounded-[var(--radius-brand-sm)] border px-3 py-2.5 text-center text-sm ${
                          fulfillment === option.value ? "border-brand bg-brand/10 font-medium" : "border-brand-border"
                        }`}
                      >
                        <input
                          type="radio"
                          name="fulfillment"
                          value={option.value}
                          checked={fulfillment === option.value}
                          onChange={() => setFulfillment(option.value)}
                          className="sr-only"
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                  {effectiveFulfillment === "recoger" && (
                    <p className="text-xs text-brand-muted">
                      Recoges en {organization.billing_address || "el local"}. Sin costo de domicilio.
                    </p>
                  )}
                </fieldset>
              )}

              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="customerName">Tu nombre</Label>
                  <Input
                    id="customerName"
                    value={customer.name}
                    onChange={(event) => setCustomer({ ...customer, name: event.target.value })}
                    required
                    autoComplete="name"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="customerPhone">Teléfono de contacto</Label>
                  <Input
                    id="customerPhone"
                    type="tel"
                    value={customer.phone}
                    onChange={(event) => setCustomer({ ...customer, phone: event.target.value })}
                    required
                    autoComplete="tel"
                  />
                </div>
                {effectiveFulfillment === "domicilio" && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="customerAddress">Dirección de entrega</Label>
                    <Input
                      id="customerAddress"
                      value={customer.address}
                      onChange={(event) => setCustomer({ ...customer, address: event.target.value })}
                      placeholder="Calle, número, barrio, referencias"
                      required
                      autoComplete="street-address"
                    />
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="customerNotes">Observaciones del pedido (opcional)</Label>
                  <Input
                    id="customerNotes"
                    value={customer.notes}
                    onChange={(event) => setCustomer({ ...customer, notes: event.target.value })}
                    maxLength={300}
                  />
                </div>
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium text-brand-ink">Medio de pago</legend>
                {paymentOptions.map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-center gap-2 rounded-[var(--radius-brand-sm)] border px-3 py-2.5 text-sm ${
                      payment === option.value ? "border-brand bg-brand/10" : "border-brand-border"
                    }`}
                  >
                    <input
                      type="radio"
                      name="payment"
                      value={option.value}
                      checked={payment === option.value}
                      onChange={() => setPayment(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
                {payment === "transferencia" && settings.transfer_instructions && (
                  <p className="rounded-[var(--radius-brand-sm)] bg-black/[0.03] px-3 py-2 text-sm text-brand-muted">
                    {settings.transfer_instructions}
                  </p>
                )}
              </fieldset>

              {error && (
                <p className="rounded-[var(--radius-brand-sm)] bg-brand-danger/10 px-3 py-2 text-sm text-brand-danger">
                  {error}
                </p>
              )}

              <div className="mt-auto flex flex-col gap-2">
                <Button
                  type="submit"
                  size="lg"
                  disabled={sending || cart.length === 0 || hasUnavailable || ordersClosed}
                  className="w-full"
                >
                  {sending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Seguir con la compra · {money(total)}
                </Button>
                <Button type="button" variant="outline" className="w-full" onClick={() => setCartOpen(false)}>
                  <ArrowLeft className="h-4 w-4" />
                  Seguir agregando productos
                </Button>
              </div>
              <BrandFooter className="-mx-4 -mb-4" />
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
