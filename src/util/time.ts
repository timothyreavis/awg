export function nowIso(): string {
  return new Date().toISOString();
}

export function todayPathParts(now = new Date()): { year: string; month: string; date: string } {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const date = `${year}-${month}-${String(now.getDate()).padStart(2, "0")}`;
  return { year, month, date };
}

export function isPastDate(value: string, now = new Date()): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && time < now.getTime();
}
