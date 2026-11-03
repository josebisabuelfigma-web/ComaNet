import type { RestaurantSettings } from "@/lib/supabase/types";

const TIME_ZONE = "America/Bogota";
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export const DAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

type Schedule = Pick<RestaurantSettings, "opens_at" | "closes_at" | "open_days">;

function toMinutes(value: string): number {
  const [h, m] = value.split(":");
  return Number(h) * 60 + Number(m);
}

function bogotaParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    day: WEEKDAYS[get("weekday")] ?? 0,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** ¿Estamos dentro del horario de atención ahora mismo (hora de Colombia)? */
export function isWithinSchedule(schedule: Schedule, date = new Date()): boolean {
  const days = schedule.open_days?.length ? schedule.open_days : [0, 1, 2, 3, 4, 5, 6];
  const { day, minutes } = bogotaParts(date);

  if (!schedule.opens_at || !schedule.closes_at) return days.includes(day);

  const opens = toMinutes(schedule.opens_at);
  const closes = toMinutes(schedule.closes_at);
  if (opens === closes) return days.includes(day); // 24 horas

  if (opens < closes) return days.includes(day) && minutes >= opens && minutes < closes;

  // Cruza la medianoche: la parte después de las 00:00 pertenece al día anterior.
  if (minutes >= opens) return days.includes(day);
  if (minutes < closes) return days.includes((day + 6) % 7);
  return false;
}

function formatHour(value: string): string {
  const [h, m] = value.split(":").map(Number);
  const suffix = h >= 12 ? "p. m." : "a. m.";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Ej: "Lun a Dom · 5:00 p. m. – 11:00 p. m." (o solo las horas / vacío). */
export function scheduleLabel(schedule: Schedule): string {
  const parts: string[] = [];
  const days = [...(schedule.open_days ?? [])].sort();
  if (days.length > 0 && days.length < 7) parts.push(days.map((d) => DAY_LABELS[d]).join(", "));
  if (schedule.opens_at && schedule.closes_at) {
    parts.push(`${formatHour(schedule.opens_at)} – ${formatHour(schedule.closes_at)}`);
  }
  return parts.join(" · ");
}