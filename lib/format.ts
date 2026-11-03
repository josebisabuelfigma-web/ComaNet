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
