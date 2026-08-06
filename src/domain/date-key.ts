const shanghaiFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function shanghaiDateKey(date = new Date()): string {
  return shanghaiFormatter.format(date);
}

export function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function weekStartDateKey(dateKey = shanghaiDateKey()): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  return shiftDateKey(dateKey, -daysSinceMonday);
}

export function currentStreakDays(dateKeys: string[], today = shanghaiDateKey()): number {
  const dates = new Set(dateKeys);
  let cursor = dates.has(today) ? today : shiftDateKey(today, -1);
  let streak = 0;
  while (dates.has(cursor)) {
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return streak;
}
