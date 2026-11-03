"use server";

import { revalidatePath } from "next/cache";

import { requireOrgRole } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { createClient } from "@/lib/supabase/server";
import { friendlyDbError } from "@/lib/db-errors";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_FILE_SIZE_MB,
  categorySchema,
  comboSchema,
  productSchema,
} from "@/lib/validations/menu";

type ActionResult = { error?: string } | void;

function refresh() {
  revalidatePath("/dashboard/menu");
}

export async function createCategory(name: string, isCombo = false): Promise<ActionResult> {
  const profile = await requireOrgRole("owner");
  const parsed = categorySchema.safeParse({ name });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { count } = await supabase
    .from("menu_categories")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", profile.organization_id);

  const { error } = await supabase.from("menu_categories").insert({
    organization_id: profile.organization_id,
    name: parsed.data.name,
    sort_order: isCombo ? -1 : count ?? 0,
    is_combo_category: isCombo,
  });
  if (error) {
    return {
      error: friendlyDbError(error, "createCategory", "No se pudo crear la categoría", {
        "23505": "Ya tienes una categoría de combos",
      }),
    };
  }

  await logActivity(profile, "Creó categoría", parsed.data.name);
  refresh();
}

export async function renameCategory(categoryId: string, name: string): Promise<ActionResult> {
  const profile = await requireOrgRole("owner");
  const parsed = categorySchema.safeParse({ name });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("menu_categories")
    .update({ name: parsed.data.name })
    .eq("id", categoryId)
    .eq("organization_id", profile.organization_id);
  if (error) return { error: friendlyDbError(error, "renameCategory", "No se pudo renombrar la categoría") };

  await logActivity(profile, "Renombró categoría", parsed.data.name);
  refresh();
}

export async function deleteCategory(categoryId: string): Promise<ActionResult> {
  const profile = await requireOrgRole("owner");
  const supabase = await createClient();

  const { error } = await supabase
    .from("menu_categories")
    .delete()
    .eq("id", categoryId)
    .eq("organization_id", profile.organization_id);
  if (error) {
    return {
      error: friendlyDbError(error, "deleteCategory", "No se pudo eliminar la categoría", {
        "23001": "Algún producto de esta categoría hace parte de un combo. Quítalo del combo primero.",
        "23503": "Algún producto de esta categoría hace parte de un combo. Quítalo del combo primero.",
      }),
    };
  }

  await logActivity(profile, "Eliminó categoría", categoryId);
  refresh();
}

/** Crea (sin productId) o edita un producto. Recibe un FormData por la foto. */
export async function saveProduct(
  productId: string | null,
  formData: FormData
): Promise<ActionResult> {
  const profile = await requireOrgRole("owner");

  const parsed = productSchema.safeParse({
    categoryId: formData.get("categoryId"),
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    price: formData.get("price"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();

  let imageUrl: string | undefined;
  const file = formData.get("image") as File | null;
  if (file && file.size > 0) {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type)) {
      return { error: "La foto debe ser PNG, JPG o WEBP" };
    }
    if (file.size > MAX_IMAGE_FILE_SIZE_MB * 1024 * 1024) {
      return { error: `La foto no puede superar ${MAX_IMAGE_FILE_SIZE_MB}MB` };
    }
    const path = `${profile.organization_id}/${crypto.randomUUID()}`;
    const { error: uploadError } = await supabase.storage
      .from("menu")
      .upload(path, file, { contentType: file.type });
    if (uploadError) {
      return { error: friendlyDbError(uploadError, "saveProduct:upload", "No se pudo subir la foto") };
    }
    imageUrl = supabase.storage.from("menu").getPublicUrl(path).data.publicUrl;
  }

  const removeImage = formData.get("removeImage") === "1";

  const values = {
    category_id: parsed.data.categoryId,
    name: parsed.data.name,
    description: parsed.data.description || null,
    price: parsed.data.price,
    ...(imageUrl ? { image_url: imageUrl } : removeImage ? { image_url: null } : {}),
  };

  if (productId) {
    const { error } = await supabase
      .from("menu_products")
      .update(values)
      .eq("id", productId)
      .eq("organization_id", profile.organization_id);
    if (error) return { error: friendlyDbError(error, "saveProduct:update", "No se pudo guardar el producto") };
    await logActivity(profile, "Editó producto", parsed.data.name);
  } else {
    const { count } = await supabase
      .from("menu_products")
      .select("id", { count: "exact", head: true })
      .eq("category_id", parsed.data.categoryId);
    const { error } = await supabase.from("menu_products").insert({
      ...values,
      organization_id: profile.organization_id,
      sort_order: count ?? 0,
    });
    if (error) return { error: friendlyDbError(error, "saveProduct:insert", "No se pudo crear el producto") };
    await logActivity(profile, "Creó producto", parsed.data.name);
  }

  refresh();
}

export async function deleteProduct(productId: string, name: string): Promise<ActionResult> {
  const profile = await requireOrgRole("owner");
  const supabase = await createClient();

  const { error } = await supabase
    .from("menu_products")
    .delete()
    .eq("id", productId)
    .eq("organization_id", profile.organization_id);
  if (error) {
    return {
      error: friendlyDbError(error, "deleteProduct", "No se pudo eliminar el producto", {
        "23001": "Este producto hace parte de un combo. Quítalo del combo primero.",
        "23503": "Este producto hace parte de un combo. Quítalo del combo primero.",
      }),
    };
  }

  await logActivity(profile, "Eliminó producto", name);
  refresh();
}

/** Oculta o muestra un producto en la carta pública (distinto de "agotado"). */
export async function setProductActive(productId: string, active: boolean): Promise<ActionResult> {
  const profile = await requireOrgRole("owner");
  const supabase = await createClient();

  const { error } = await supabase
    .from("menu_products")
    .update({ is_active: active })
    .eq("id", productId)
    .eq("organization_id", profile.organization_id);
  if (error) return { error: friendlyDbError(error, "setProductActive", "No se pudo actualizar el producto") };

  refresh();
}

/** Marca un producto como agotado / disponible. Owner y cajero. */
export async function setProductAvailability(
  productId: string,
  name: string,
  available: boolean
): Promise<ActionResult> {
  const profile = await requireOrgRole("owner", "cajero");
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_product_availability", {
    p_product_id: productId,
    p_available: available,
  });
  if (error) {
    return { error: friendlyDbError(error, "setProductAvailability", "No se pudo actualizar la disponibilidad") };
  }

  await logActivity(profile, available ? "Marcó disponible" : "Marcó agotado", name);
  refresh();
}

/** Crea (sin comboId) o edita un combo: nombre, precio total y sus productos. */
export async function saveCombo(
  comboId: string | null,
  formData: FormData
): Promise<ActionResult> {
  const profile = await requireOrgRole("owner");

  let rawItems: unknown = [];
  try {
    rawItems = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { error: "Los productos del combo no son válidos" };
  }

  const parsed = comboSchema.safeParse({
    categoryId: formData.get("categoryId"),
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    price: formData.get("price"),
    items: rawItems,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();

  // Un combo solo se arma con productos que ya existen.
  const { count: regularCount } = await supabase
    .from("menu_products")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", profile.organization_id)
    .eq("is_combo", false);
  if (!regularCount) return { error: "Primero crea al menos un producto para poder armar combos" };

  let imageUrl: string | undefined;
  const file = formData.get("image") as File | null;
  if (file && file.size > 0) {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type)) return { error: "La foto debe ser PNG, JPG o WEBP" };
    if (file.size > MAX_IMAGE_FILE_SIZE_MB * 1024 * 1024) {
      return { error: `La foto no puede superar ${MAX_IMAGE_FILE_SIZE_MB}MB` };
    }
    const path = `${profile.organization_id}/${crypto.randomUUID()}`;
    const { error: uploadError } = await supabase.storage
      .from("menu")
      .upload(path, file, { contentType: file.type });
    if (uploadError) {
      return { error: friendlyDbError(uploadError, "saveCombo:upload", "No se pudo subir la foto") };
    }
    imageUrl = supabase.storage.from("menu").getPublicUrl(path).data.publicUrl;
  }
  const removeImage = formData.get("removeImage") === "1";

  const values = {
    category_id: parsed.data.categoryId,
    name: parsed.data.name,
    description: parsed.data.description || null,
    price: parsed.data.price,
    is_combo: true,
    ...(imageUrl ? { image_url: imageUrl } : removeImage ? { image_url: null } : {}),
  };

  let id = comboId;
  if (id) {
    const { error } = await supabase
      .from("menu_products")
      .update(values)
      .eq("id", id)
      .eq("organization_id", profile.organization_id);
    if (error) return { error: friendlyDbError(error, "saveCombo:update", "No se pudo guardar el combo") };
  } else {
    const { data: created, error } = await supabase
      .from("menu_products")
      .insert({ ...values, organization_id: profile.organization_id, sort_order: 0 })
      .select("id")
      .single();
    if (error || !created) {
      return { error: friendlyDbError(error, "saveCombo:insert", "No se pudo crear el combo") };
    }
    id = created.id;
  }

  // Reemplaza los productos del combo.
  const { error: clearError } = await supabase.from("menu_combo_items").delete().eq("combo_id", id);
  if (clearError) return { error: friendlyDbError(clearError, "saveCombo:clear", "No se pudo guardar el combo") };

  const { error: itemsError } = await supabase.from("menu_combo_items").insert(
    parsed.data.items.map((item) => ({
      organization_id: profile.organization_id,
      combo_id: id!,
      product_id: item.productId,
      quantity: item.quantity,
    }))
  );
  if (itemsError) {
    if (!comboId) await supabase.from("menu_products").delete().eq("id", id!);
    return { error: friendlyDbError(itemsError, "saveCombo:items", "No se pudieron guardar los productos del combo") };
  }

  await logActivity(profile, comboId ? "Editó combo" : "Creó combo", parsed.data.name);
  refresh();
}