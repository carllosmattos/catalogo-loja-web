import type { Customer } from "@/types";

export const BRAZILIAN_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

export interface AddressFields {
  zip: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
}

export function addressFieldsFromCustomer(
  customer: Partial<Customer> | null | undefined
): AddressFields {
  const c = customer || {};
  return {
    zip: c.address_zip || "",
    street: c.address_street || "",
    number: c.address_number || "",
    complement: c.address_complement || "",
    neighborhood: c.address_neighborhood || "",
    city: c.address_city || "",
    state: (c.address_state || "").toUpperCase(),
  };
}

function formatAddressLines(fields: AddressFields): string {
  let line1 = fields.street.trim();
  if (fields.number.trim()) {
    line1 = line1 ? `${line1}, ${fields.number.trim()}` : fields.number.trim();
  }
  if (fields.complement.trim()) {
    line1 = line1
      ? `${line1} — ${fields.complement.trim()}`
      : fields.complement.trim();
  }
  const parts: string[] = [];
  if (fields.neighborhood.trim()) parts.push(fields.neighborhood.trim());
  const city = fields.city.trim();
  const state = fields.state.trim();
  if (city && state) parts.push(`${city}/${state}`);
  else if (city) parts.push(city);
  else if (state) parts.push(state);
  const zipDigits = fields.zip.replace(/\D/g, "");
  if (zipDigits.length === 8) {
    parts.push(`CEP ${zipDigits.slice(0, 5)}-${zipDigits.slice(5)}`);
  } else if (zipDigits) {
    parts.push(`CEP ${zipDigits}`);
  }
  const line2 = parts.join(" — ");
  return [line1, line2].filter(Boolean).join("\n");
}

export function formatCustomerAddress(
  customer: Partial<Customer> | null | undefined
): string {
  if (!customer) return "";
  const fields = addressFieldsFromCustomer(customer);
  if (Object.values(fields).some(Boolean)) return formatAddressLines(fields);
  return (customer.address || "").trim();
}
