/** Dias da semana: 0=Dom … 6=Sáb (igual Date.getDay()). */

export const WEEKDAY_OPTIONS: { value: number; label: string; short: string }[] = [
  { value: 1, label: "Segunda", short: "Seg" },
  { value: 2, label: "Terça", short: "Ter" },
  { value: 3, label: "Quarta", short: "Qua" },
  { value: 4, label: "Quinta", short: "Qui" },
  { value: 5, label: "Sexta", short: "Sex" },
  { value: 6, label: "Sábado", short: "Sáb" },
  { value: 0, label: "Domingo", short: "Dom" },
];

export function weekdayLabel(day: number): string {
  return WEEKDAY_OPTIONS.find((w) => w.value === day)?.label || String(day);
}

/**
 * Próximo dia de envio a partir de `from` (inclusivo: se hoje é dia de envio, retorna hoje).
 */
export function nextDispatchDate(
  from: Date,
  weekdays: number[]
): { date: Date; waitDays: number; weekday: number } | null {
  const unique = [...new Set(weekdays.filter((d) => d >= 0 && d <= 6))];
  if (!unique.length) return null;

  const start = new Date(from);
  start.setHours(0, 0, 0, 0);

  for (let wait = 0; wait <= 14; wait++) {
    const d = new Date(start);
    d.setDate(start.getDate() + wait);
    const wd = d.getDay();
    if (unique.includes(wd)) {
      return { date: d, waitDays: wait, weekday: wd };
    }
  }
  return null;
}

export function formatDispatchDeadline(
  waitDays: number,
  transportDays: number | null,
  _weekday?: number
): string {
  const total =
    transportDays != null && Number.isFinite(transportDays)
      ? waitDays + Math.max(0, transportDays)
      : waitDays;

  if (total <= 0) return "mesmo dia";
  if (total === 1) return "até 1 dia";
  return `até ${total} dias`;
}

export function parseDispatchWeekdays(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  }
  if (typeof raw === "string") {
    try {
      return parseDispatchWeekdays(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}
