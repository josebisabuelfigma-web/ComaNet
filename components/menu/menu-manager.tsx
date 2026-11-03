"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ImagePicker } from "@/components/image-picker";
import { QuantityStepper } from "@/components/quantity-stepper";
import {
  createCategory,
  deleteCategory,
  deleteProduct,
  renameCategory,
  saveCombo,
  saveProduct,
  setProductActive,
  setProductAvailability,
} from "@/lib/actions/menu";
import { formatMoney } from "@/lib/format";
import { comboContents } from "@/lib/combos";
import type { MenuCategory, MenuComboItem, MenuProduct } from "@/lib/supabase/types";

interface MenuManagerProps {
  categories: MenuCategory[];
  products: MenuProduct[];
  comboItems: MenuComboItem[];
  currency: string;
  /** El owner edita todo; el cajero solo marca agotado / disponible. */
  canEdit: boolean;
}

type ProductDialog = { product: MenuProduct | null; categoryId: string } | null;
type ComboDialog = { combo: MenuProduct | null; categoryId: string } | null;

export function MenuManager({ categories, products, comboItems, currency, canEdit }: MenuManagerProps) {
  const router = useRouter();
  const [categoryDialog, setCategoryDialog] = React.useState<{ category: MenuCategory | null } | null>(null);
  const [categoryName, setCategoryName] = React.useState("");
  const [productDialog, setProductDialog] = React.useState<ProductDialog>(null);
  const [comboDialog, setComboDialog] = React.useState<ComboDialog>(null);
  const [comboSelection, setComboSelection] = React.useState<Record<string, number>>({});

  const regularProducts = products.filter((p) => !p.is_combo);
  const comboCategory = categories.find((c) => c.is_combo_category) ?? null;

  function openComboDialog(combo: MenuProduct | null, categoryId: string) {
    setError(null);
    setComboSelection(
      Object.fromEntries(
        comboItems.filter((i) => combo && i.combo_id === combo.id).map((i) => [i.product_id, i.quantity])
      )
    );
    setComboDialog({ combo, categoryId });
  }

  async function handleSaveCombo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!comboDialog) return;
    const form = new FormData(event.currentTarget);
    form.set(
      "items",
      JSON.stringify(
        Object.entries(comboSelection).map(([productId, quantity]) => ({ productId, quantity }))
      )
    );
    const ok = await runSave(() => saveCombo(comboDialog.combo?.id ?? null, form));
    if (!ok) return;
    setComboDialog(null);
    router.refresh();
  }

  /** Ejecuta un guardado sin dejar el botón en "Guardando..." si algo falla. */
  async function runSave(action: () => Promise<{ error?: string } | void>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result?.error) {
        setError(result.error);
        return false;
      }
      return true;
    } catch {
      setError("No se pudo guardar. Si subiste una foto, prueba con una más liviana e inténtalo de nuevo.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function suggestComboCategory() {
    setBusy(true);
    setError(null);
    const result = await createCategory("Combos", true);
    setBusy(false);
    if (result?.error) return setError(result.error);
    router.refresh();
  }
  const [deletingCategory, setDeletingCategory] = React.useState<MenuCategory | null>(null);
  const [deletingProduct, setDeletingProduct] = React.useState<MenuProduct | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = React.useState<string | null>(null);

  function openCategoryDialog(category: MenuCategory | null) {
    setCategoryName(category?.name ?? "");
    setError(null);
    setCategoryDialog({ category });
  }

  async function handleSaveCategory(event: React.FormEvent) {
    event.preventDefault();
    if (!categoryDialog) return;
    setBusy(true);
    const result = categoryDialog.category
      ? await renameCategory(categoryDialog.category.id, categoryName)
      : await createCategory(categoryName);
    setBusy(false);
    if (result?.error) return setError(result.error);
    setCategoryDialog(null);
    router.refresh();
  }

  async function handleSaveProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!productDialog) return;
    const form = new FormData(event.currentTarget);
    const ok = await runSave(() => saveProduct(productDialog.product?.id ?? null, form));
    if (!ok) return;
    setProductDialog(null);
    router.refresh();
  }

  async function handleAvailability(product: MenuProduct, available: boolean) {
    setPendingToggle(product.id);
    await setProductAvailability(product.id, product.name, available);
    setPendingToggle(null);
    router.refresh();
  }

  async function handleActive(product: MenuProduct) {
    setPendingToggle(product.id);
    await setProductActive(product.id, !product.is_active);
    setPendingToggle(null);
    router.refresh();
  }

  async function confirmDeleteCategory() {
    if (!deletingCategory) return;
    setBusy(true);
    await deleteCategory(deletingCategory.id);
    setBusy(false);
    setDeletingCategory(null);
    router.refresh();
  }

  async function confirmDeleteProduct() {
    if (!deletingProduct) return;
    setBusy(true);
    await deleteProduct(deletingProduct.id, deletingProduct.name);
    setBusy(false);
    setDeletingProduct(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-brand-ink">Carta y productos</h1>
          <p className="text-sm text-brand-muted">
            {canEdit
              ? "Organiza tu carta por categorías. Todo producto nuevo queda disponible."
              : "Marca como agotado lo que se acabó; el cambio se ve al instante en la carta del cliente."}
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => openCategoryDialog(null)}>
            <Plus className="h-4 w-4" />
            Nueva categoría
          </Button>
        )}
      </div>

      {canEdit && !comboCategory && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-brand-md)] border border-brand bg-brand/10 p-4">
          <div>
            <p className="font-medium text-brand-ink">Sugerencia: crea la categoría &quot;Combos&quot;</p>
            <p className="text-sm text-brand-muted">
              Arma combos con varios de tus productos y ponles un precio total. En los reportes se
              desglosan producto por producto.
            </p>
          </div>
          <Button onClick={suggestComboCategory} disabled={busy}>
            <Plus className="h-4 w-4" />
            Crear categoría Combos
          </Button>
        </div>
      )}
      {error && !categoryDialog && !productDialog && !comboDialog && (
        <p className="text-sm text-brand-danger">{error}</p>
      )}

      {categories.length === 0 && (
        <div className="rounded-[var(--radius-brand-md)] border border-dashed border-brand-border bg-white p-10 text-center text-brand-muted">
          Aún no hay categorías. Crea la primera (ej: Hamburguesas, Perros, Bebidas).
        </div>
      )}

      {categories.map((category) => {
        const items = products.filter((p) => p.category_id === category.id);
        return (
          <Card key={category.id}>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle className="min-w-0 break-words">{category.name}</CardTitle>
              {canEdit && (
                <div className="flex items-center gap-1">
                  {category.is_combo_category ? (
                    <Button
                      size="sm"
                      disabled={regularProducts.length === 0}
                      title={regularProducts.length === 0 ? "Primero crea al menos un producto" : undefined}
                      onClick={() => openComboDialog(null, category.id)}
                    >
                      <Plus className="h-4 w-4" />
                      Combo
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => {
                        setError(null);
                        setProductDialog({ product: null, categoryId: category.id });
                      }}
                    >
                      <Plus className="h-4 w-4" />
                      Producto
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => openCategoryDialog(category)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeletingCategory(category)}>
                    <Trash2 className="h-4 w-4 text-brand-danger" />
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {category.is_combo_category && regularProducts.length === 0 && (
                <p className="mb-2 text-sm text-brand-muted">
                  Para crear un combo primero debes tener al menos un producto en otra categoría.
                </p>
              )}
              {items.length === 0 ? (
                <p className="text-sm text-brand-muted">
                  {category.is_combo_category ? "Aún no hay combos." : "Sin productos en esta categoría."}
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-brand-border">
                  {items.map((product) => (
                    <li key={product.id} className="flex flex-col gap-3 py-4">
                      <div className="flex gap-3">
                        {product.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={product.image_url}
                            alt={product.name}
                            className="h-16 w-16 shrink-0 rounded-[var(--radius-brand-sm)] object-cover"
                          />
                        ) : (
                          <div className="h-16 w-16 shrink-0 rounded-[var(--radius-brand-sm)] bg-black/5" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-brand-ink">
                            <span className="break-words">{product.name}</span>
                            {!product.is_active && (
                              <Badge variant="muted">
                                <EyeOff className="mr-1 h-3 w-3" />
                                Oculto
                              </Badge>
                            )}
                          </p>
                          <p className="line-clamp-2 text-sm text-brand-muted">
                            {product.is_combo
                              ? `Incluye: ${comboContents(product.id, products, comboItems) || "—"}`
                              : product.description || "Sin descripción"}
                          </p>
                          <p className="mt-0.5 font-semibold text-brand-ink">
                            {formatMoney(product.price, currency)}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                        <label className="flex items-center gap-2 text-sm">
                          <Switch
                            checked={product.is_available}
                            disabled={pendingToggle === product.id}
                            onCheckedChange={(checked) => handleAvailability(product, checked)}
                          />
                          <span className={product.is_available ? "text-brand-success" : "text-brand-danger"}>
                            {product.is_available
                              ? "Disponible"
                              : product.is_combo && product.combo_auto_off
                                ? "No disponible (producto agotado)"
                                : "Agotado"}
                          </span>
                        </label>
                        {canEdit && (
                          <div className="flex items-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              title={product.is_active ? "Ocultar de la carta" : "Mostrar en la carta"}
                              aria-label={product.is_active ? "Ocultar de la carta" : "Mostrar en la carta"}
                              disabled={pendingToggle === product.id}
                              onClick={() => handleActive(product)}
                            >
                              {product.is_active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Editar"
                              onClick={() => {
                                if (product.is_combo) return openComboDialog(product, product.category_id);
                                setError(null);
                                setProductDialog({ product, categoryId: product.category_id });
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Eliminar"
                              onClick={() => setDeletingProduct(product)}
                            >
                              <Trash2 className="h-4 w-4 text-brand-danger" />
                            </Button>
                          </div>
                        )}
                      </div>
                      {product.is_combo &&
                        product.is_available &&
                        comboItems
                          .filter((i) => i.combo_id === product.id)
                          .some((i) => products.find((p) => p.id === i.product_id && !p.is_available)) && (
                          <p className="text-xs text-brand-muted">
                            Activo aunque un producto del combo está agotado (el producto sigue agotado).
                          </p>
                        )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={!!categoryDialog} onOpenChange={(value) => !value && setCategoryDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{categoryDialog?.category ? "Renombrar categoría" : "Nueva categoría"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveCategory} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="categoryName">Nombre</Label>
              <Input
                id="categoryName"
                value={categoryName}
                onChange={(event) => setCategoryName(event.target.value)}
                placeholder="Ej: Hamburguesas"
                required
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-brand-danger">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCategoryDialog(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Guardando..." : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!productDialog} onOpenChange={(value) => !value && setProductDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{productDialog?.product ? "Editar producto" : "Nuevo producto"}</DialogTitle>
          </DialogHeader>
          {productDialog && (
            <form
              key={productDialog.product?.id ?? `new-${productDialog.categoryId}`}
              onSubmit={handleSaveProduct}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="categoryId">Categoría</Label>
                <select
                  id="categoryId"
                  name="categoryId"
                  defaultValue={productDialog.categoryId}
                  className="h-10 rounded-[var(--radius-brand-sm)] border border-brand-border bg-white px-3 text-sm"
                >
                  {categories
                    .filter((c) => !c.is_combo_category)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Nombre</Label>
                <Input id="name" name="name" defaultValue={productDialog.product?.name} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="price">Precio</Label>
                <Input
                  id="price"
                  name="price"
                  type="number"
                  min={0}
                  step={100}
                  defaultValue={productDialog.product?.price}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="description">Descripción / ingredientes</Label>
                <textarea
                  id="description"
                  name="description"
                  rows={3}
                  maxLength={600}
                  defaultValue={productDialog.product?.description ?? ""}
                  placeholder="Ej: Carne 150g, queso cheddar, lechuga, tomate, salsa de la casa"
                  className="rounded-[var(--radius-brand-sm)] border border-brand-border bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>
              <ImagePicker name="image" currentUrl={productDialog.product?.image_url} label="Foto (opcional)" />
              {error && <p className="text-sm text-brand-danger">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setProductDialog(null)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Guardando..." : "Guardar"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!comboDialog} onOpenChange={(value) => !value && setComboDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{comboDialog?.combo ? "Editar combo" : "Nuevo combo"}</DialogTitle>
          </DialogHeader>
          {comboDialog && (
            <form
              key={comboDialog.combo?.id ?? "new-combo"}
              onSubmit={handleSaveCombo}
              className="flex flex-col gap-4"
            >
              <input type="hidden" name="categoryId" value={comboDialog.categoryId} />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="comboName">Nombre del combo</Label>
                <Input id="comboName" name="name" defaultValue={comboDialog.combo?.name} placeholder="Ej: Combo 1" required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="comboPrice">Precio total del combo</Label>
                <Input
                  id="comboPrice"
                  name="price"
                  type="number"
                  min={0}
                  step={100}
                  defaultValue={comboDialog.combo?.price}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Productos del combo</Label>
                <p className="text-xs text-brand-muted">
                  Marca los productos que incluye y la cantidad de cada uno. Solo puedes elegir
                  productos que ya existen.
                </p>
                <ul className="flex flex-col divide-y divide-brand-border rounded-[var(--radius-brand-sm)] border border-brand-border">
                  {regularProducts.map((product) => {
                    const selected = comboSelection[product.id] !== undefined;
                    return (
                      <li key={product.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                        <label className="flex min-w-0 flex-1 items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={(event) =>
                              setComboSelection((current) => {
                                const next = { ...current };
                                if (event.target.checked) next[product.id] = 1;
                                else delete next[product.id];
                                return next;
                              })
                            }
                          />
                          <span className="truncate">{product.name}</span>
                          <span className="text-xs text-brand-muted">{formatMoney(product.price, currency)}</span>
                        </label>
                        {selected && (
                          <QuantityStepper
                            value={comboSelection[product.id]}
                            onChange={(quantity) =>
                              setComboSelection((current) => ({ ...current, [product.id]: quantity }))
                            }
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
                {Object.keys(comboSelection).length > 0 && (
                  <p className="text-xs text-brand-muted">
                    Suma de los precios sueltos:{" "}
                    {formatMoney(
                      Object.entries(comboSelection).reduce(
                        (sum, [id, qty]) => sum + Number(products.find((p) => p.id === id)?.price ?? 0) * qty,
                        0
                      ),
                      currency
                    )}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="comboDescription">Descripción (opcional)</Label>
                <textarea
                  id="comboDescription"
                  name="description"
                  rows={2}
                  maxLength={600}
                  defaultValue={comboDialog.combo?.description ?? ""}
                  className="rounded-[var(--radius-brand-sm)] border border-brand-border bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>
              <ImagePicker name="image" currentUrl={comboDialog.combo?.image_url} label="Foto (opcional)" />
              {error && <p className="text-sm text-brand-danger">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setComboDialog(null)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Guardando..." : "Guardar combo"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deletingCategory}
        onOpenChange={(value) => !value && setDeletingCategory(null)}
        title="Eliminar categoría"
        description={`¿Eliminar "${deletingCategory?.name}" y todos sus productos? Los pedidos ya hechos conservan su historial.`}
        isLoading={busy}
        onConfirm={confirmDeleteCategory}
      />
      <ConfirmDialog
        open={!!deletingProduct}
        onOpenChange={(value) => !value && setDeletingProduct(null)}
        title="Eliminar producto"
        description={`¿Eliminar "${deletingProduct?.name}" de la carta?`}
        isLoading={busy}
        onConfirm={confirmDeleteProduct}
      />
    </div>
  );
}
