import type { MenuComboItem, MenuProduct } from "@/lib/supabase/types";

/**
 * Ids de productos que NO se pueden pedir ahora: agotados, o combos sin
 * productos / con algún producto oculto. (Si un producto se agota, la base de
 * datos apaga sola el combo; el administrador puede reactivarlo a mano.) Misma
 * regla que product_is_orderable().
 */
export function unavailableProductIds(
  products: MenuProduct[],
  comboItems: MenuComboItem[]
): Set<string> {
  const byId = new Map(products.map((p) => [p.id, p]));
  const result = new Set<string>();

  for (const product of products) {
    if (!product.is_available) result.add(product.id);
  }

  for (const product of products) {
    if (!product.is_combo) continue;
    const parts = comboItems.filter((item) => item.combo_id === product.id);
    const broken =
      parts.length === 0 ||
      parts.some((part) => {
        const component = byId.get(part.product_id);
        return !component || !component.is_active;
      });
    if (broken) result.add(product.id);
  }

  return result;
}

/** "1 × Clásica, 2 × Papas" a partir de los componentes de un combo. */
export function comboContents(
  comboId: string,
  products: MenuProduct[],
  comboItems: MenuComboItem[]
): string {
  const byId = new Map(products.map((p) => [p.id, p]));
  return comboItems
    .filter((item) => item.combo_id === comboId)
    .map((item) => `${item.quantity} × ${byId.get(item.product_id)?.name ?? "producto"}`)
    .join(", ");
}
