/** Timezone helpers (default Asia/Tashkent, UTC+5, no DST — but computed generically). */

function parts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: Number(p.hour), mm: Number(p.minute), ss: Number(p.second) };
}

export function localMinutesOfDay(date: Date, timeZone: string): number {
  const p = parts(date, timeZone);
  return p.hh * 60 + p.mm;
}

function hhmmToMinutes(v: string): number {
  const [h, m] = v.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Supports overnight windows such as 18:00–02:00. Equal start/end means 24 hours. */
export function isWithinOperatingHours(date: Date, start: string, end: string, timeZone: string): boolean {
  const now = localMinutesOfDay(date, timeZone);
  const s = hhmmToMinutes(start);
  const e = hhmmToMinutes(end);
  if (s === e) return true;
  return s < e ? now >= s && now < e : now >= s || now < e;
}

/** UTC instant of local midnight for the day containing `date` in `timeZone`. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const p = parts(date, timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  const offsetMs = asUtc - Math.floor(date.getTime() / 1000) * 1000;
  return new Date(Date.UTC(p.y, p.m - 1, p.d) - offsetMs);
}

export function formatDateTimeUz(date: Date | string, timeZone = "Asia/Tashkent"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const p = parts(d, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(p.d)}.${pad(p.m)}.${p.y} ${pad(p.hh)}:${pad(p.mm)}`;
}
