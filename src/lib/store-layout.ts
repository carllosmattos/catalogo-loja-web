/** Classes compartilhadas para layout responsivo da loja */

export const STORE_CONTAINER =
  "mx-auto w-full max-w-lg px-4 sm:max-w-xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl";

export const STORE_MAIN = `${STORE_CONTAINER} flex-1 pb-24 pt-4 md:pb-8 md:pt-6`;

export const PRODUCT_GRID =
  "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4";

/** Card clicável (produto, pedido…) */
export const STORE_CARD =
  "rounded-2xl bg-white shadow-sm ring-1 ring-black/5 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lg hover:ring-[var(--color-primary)]/25 active:translate-y-0 active:shadow-md";

/** Botão primário da loja */
export const STORE_BTN_PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-full bg-[var(--color-primary)] px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:brightness-110 hover:shadow-md active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";

/** Botão / link secundário com borda */
export const STORE_BTN_OUTLINE =
  "inline-flex items-center justify-center gap-2 rounded-full border border-[var(--color-primary)]/35 bg-white px-6 py-3 text-sm font-semibold text-[var(--color-primary)] transition-all duration-200 hover:border-[var(--color-primary)] hover:bg-[var(--color-accent)] hover:shadow-sm active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";

/** Ícone / chip clicável */
export const STORE_ICON_BTN =
  "rounded-full p-2 text-[var(--color-primary)] transition-all duration-200 hover:bg-[var(--color-accent)] hover:scale-105 active:scale-95";
