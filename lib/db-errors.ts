import "server-only";

const FRIENDLY_MESSAGES: Record<string, string> = {
  "23505": "Ya existe un registro con ese valor único (revisa si algo se repite, como un nombre o un código).",
  "23503": "No se pudo completar: hay otro registro que depende de este.",
  "23502": "Falta un dato obligatorio.",
  "23514": "Uno de los valores no cumple una regla del sistema (revisa cantidades o formatos).",
};

// SQLSTATE que Postgres asigna a un `raise exception 'mensaje'` sin código
// explícito dentro de nuestras propias funciones RPC (create_sale, void_sale,
// adjust_stock, create_product, bulk_import_products). Esos mensajes SÍ están
// pensados para mostrarse tal cual (p. ej. "Stock insuficiente para...").
// Cualquier otro código (incluida una violación de RLS, 42501) NO se muestra
// tal cual: podría revelar nombres de tabla/columna/política internos.
const CUSTOM_EXCEPTION_CODE = "P0001";

/**
 * Traduce errores conocidos de Postgres/PostgREST a un mensaje en español
 * entendible. Siempre registra el error real en el log del servidor para
 * poder diagnosticarlo después; al usuario solo le llega el mensaje real de
 * Postgres cuando viene de una excepción que nosotros mismos lanzamos
 * (P0001) — cualquier otro código usa `overrides`, el mapa genérico, o el
 * `fallback`, nunca el texto crudo del motor.
 */
export function friendlyDbError(
  error: { code?: string; message?: string } | null | undefined,
  context: string,
  fallback: string,
  overrides?: Record<string, string>
): string {
  if (!error) return fallback;

  console.error(`[${context}]`, error);

  if (error.code && overrides?.[error.code]) {
    return overrides[error.code];
  }
  if (error.code && FRIENDLY_MESSAGES[error.code]) {
    return FRIENDLY_MESSAGES[error.code];
  }
  if (error.code === CUSTOM_EXCEPTION_CODE && error.message) {
    return error.message;
  }
  return fallback;
}
