export function formatCurrency(value: number | null | undefined): string {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  return `R$ ${safe.toFixed(2).replace(".", ",")}`;
}

export function parseWhatsappNumber(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function normalizePhoneBr(raw: string): string {
  const digits = parseWhatsappNumber(raw);
  if (digits.length < 10) return digits;
  let local = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 10 || local.length === 11) return "55" + local;
  if (local.length > 11) return "55" + local.slice(-11);
  return "55" + local;
}

export function normalizeCpf(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 11 ? digits : "";
}

export function formatCpf(cpf: string): string {
  const d = normalizeCpf(cpf) || cpf.replace(/\D/g, "");
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  const email = normalizeEmail(raw);
  if (!email || email.includes(" ")) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return Boolean(local && domain && domain.includes("."));
}

export function isValidCpf(raw: string): boolean {
  const cpf = normalizeCpf(raw);
  if (!cpf || new Set(cpf).size === 1) return false;
  const digit = (nums: number[], weights: number[]) => {
    const total = nums.reduce((sum, n, i) => sum + n * weights[i], 0);
    const rest = total % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const nums = cpf.split("").map(Number);
  if (digit(nums.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]) !== nums[9]) return false;
  if (digit(nums.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) !== nums[10]) return false;
  return true;
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
