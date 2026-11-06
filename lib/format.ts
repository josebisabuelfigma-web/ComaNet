const TIME_ZONE = "America/Bogota";

export function formatMoney(value: number | string | null | undefined, currency = "COP") {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-CO", { timeZone: TIME_ZONE });
}

export function formatTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("es-CO", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria de Colombia. */
export function todayInColombia() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeDay(value: string | undefined | null, fallback: string) {
  return value && ISO_DAY.test(value) ? value : fallback;
}

/**
 * Convierte un rango de días (YYYY-MM-DD, ambos inclusive) en el intervalo
 * [from, to) de timestamps ISO que usan los reportes. Colombia no tiene
 * horario de verano: siempre UTC-5.
 */
export function dayRangeToTimestamps(fromDay: string, toDay: string) {
  const from = new Date(`${fromDay}T00:00:00-05:00`);
  const to = new Date(`${toDay}T00:00:00-05:00`);
  to.setUTCDate(to.getUTCDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Deja solo dígitos de un teléfono (para wa.me). */
export function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

/**
 * Enlace de WhatsApp para un teléfono colombiano (acepta 3001234567 o con 57).
 * Devuelve null si el número no parece válido.
 */
export function whatsappLink(phone: string | null | undefined, message: string) {
  const digits = onlyDigits(phone ?? "");
  const full = digits.length === 10 ? `57${digits}` : digits;
  if (full.length < 11 || full.length > 15) return null;
  return `https://wa.me/${full}?text=${encodeURIComponent(message)}`;
}

const ISO_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * Valor de un <input type="datetime-local"> (YYYY-MM-DDTHH:mm, hora de Colombia).
 * Acepta también solo el día (enlaces viejos): el inicio es 00:00 y el fin 23:59.
 */
export function normalizeDateTime(value: string | undefined | null, fallback: string, endOfDay = false) {
  if (value && ISO_LOCAL.test(value)) return value;
  if (value && ISO_DAY.test(value)) return `${value}T${endOfDay ? "23:59" : "00:00"}`;
  return fallback;
}

/**
 * Rango entre dos fecha-hora de Colombia (UTC-5). El minuto final se incluye
 * completo. Si vienen al revés se invierten. Devuelve también los valores
 * ordenados para mostrarlos en el formulario.
 */
export function dateTimeRange(fromLocal: string, toLocal: string) {
  const [a, b] = fromLocal <= toLocal ? [fromLocal, toLocal] : [toLocal, fromLocal];
  const from = new Date(`${a}:00-05:00`);
  const to = new Date(new Date(`${b}:00-05:00`).getTime() + 60_000);
  return { from: from.toISOString(), to: to.toISOString(), fromLocal: a, toLocal: b };
}

/** Texto seguro para usar dentro de un filtro .or(...ilike...) de PostgREST. */
export function cleanSearch(value: string | undefined | null) {
  return (value ?? "").replace(/[,()%*\\"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}
