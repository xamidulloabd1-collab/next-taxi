/** Uzbekistan phone helpers. Stored format: E.164 (+998XXXXXXXXX). */
export function normalizeUzPhone(input: string): string | null {
  const digits = input.replace(/[^\d]/g, "");
  let local: string;
  if (digits.length === 12 && digits.startsWith("998")) local = digits.slice(3);
  else if (digits.length === 9) local = digits;
  else return null;
  // Mobile operator codes start with 3, 5, 6, 7, 8, 9 (e.g. 33, 50, 77, 88, 90, 91, 93, 94, 95, 97, 98, 99).
  if (!/^[35-9]\d{8}$/.test(local)) return null;
  return `+998${local}`;
}

export function formatUzPhone(e164: string): string {
  const m = e164.match(/^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164;
}

export function maskUzPhone(e164: string): string {
  const m = e164.match(/^\+998(\d{2})\d{5}(\d{2})$/);
  return m ? `+998 ${m[1]} *** ** ${m[2]}` : "***";
}
