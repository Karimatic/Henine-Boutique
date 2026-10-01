/**
 * Algerian phone numbers.
 * Canonical form is the national mobile format `0XXXXXXXXX` (10 digits, 05/06/07),
 * which is what customers, carriers (ZR Express) and the team all use.
 */

const MOBILE_RE = /^0[567]\d{8}$/;

/** Accepts "0550 12 34 56", "+213 550123456", "00213-550-123-456", "550123456"… */
export function normalizeDzPhone(input: string): string | null {
  let digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("213")) digits = digits.slice(3);
  if (digits.length === 9) digits = `0${digits}`;
  return MOBILE_RE.test(digits) ? digits : null;
}

export function isDzMobile(input: string): boolean {
  return normalizeDzPhone(input) !== null;
}

/** "0550123456" → "0550 12 34 56" */
export function formatDzPhone(phone: string): string {
  const p = normalizeDzPhone(phone) ?? phone;
  return p.length === 10 ? `${p.slice(0, 4)} ${p.slice(4, 6)} ${p.slice(6, 8)} ${p.slice(8)}` : p;
}

/** "0550123456" → "+213550123456" (tel: links, WhatsApp) */
export function toE164(phone: string): string | null {
  const p = normalizeDzPhone(phone);
  return p ? `+213${p.slice(1)}` : null;
}

/** "0550123456" → "05•• •• •• 56" for public tracking pages */
export function maskDzPhone(phone: string): string {
  const p = normalizeDzPhone(phone) ?? phone;
  return p.length === 10 ? `${p.slice(0, 2)}•• •• •• ${p.slice(8)}` : "••••";
}
