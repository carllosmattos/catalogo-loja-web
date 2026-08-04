"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MessageCircle, Send, X } from "lucide-react";
import { useCartStore, useCustomerStore } from "@/stores";
import { formatCurrency, cn } from "@/lib/utils";
import type { CouponValidation, ProductSize, StoreSettings } from "@/types";

type Msg = { role: "user" | "assistant"; content: string };

type ProductCard = {
  id: string;
  name: string;
  image_url: string | null;
  price: number;
  sizes: { size: string; stock: number }[];
};

type StoredChat = {
  updatedAt: number;
  messages: Msg[];
};

const IDLE_MS = 60 * 60 * 1000; // 1h

/** Pausa curta entre bolhas (não é o typewriter). */
const BETWEEN_BUBBLES_MS = 480;
const BEFORE_FIRST_MS = 320;
/** ~ms por caractere no efeito de digitação. */
const MS_PER_CHAR = 26;
const CHAR_BATCH = 2;

interface ChatFloatProps {
  settings: StoreSettings;
}

function welcomeMsg(storeName: string): Msg {
  return {
    role: "assistant",
    content: `Olá! Sou a consultora da ${storeName}. Posso ajudar a achar uma peça, ver tamanhos ou tirar dúvidas da loja 😊`,
  };
}

function storageKey(customerId: string | null | undefined) {
  return customerId ? `lm-chat:${customerId}` : null;
}

function loadStored(customerId: string | null | undefined): StoredChat | null {
  const key = storageKey(customerId);
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredChat;
    if (!parsed?.updatedAt || !Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveStored(customerId: string | null | undefined, messages: Msg[]) {
  const key = storageKey(customerId);
  if (!key || typeof window === "undefined") return;
  const payload: StoredChat = {
    updatedAt: Date.now(),
    messages: messages.slice(-40),
  };
  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    /* quota */
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Renderiza **negrito** simples; remove * soltos. */
function ChatText({ text }: { text: string }) {
  const parts = String(text || "").split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        const bold = part.match(/^\*\*([^*]+)\*\*$/);
        if (bold) {
          return (
            <strong key={i} className="font-semibold">
              {bold[1]}
            </strong>
          );
        }
        return <span key={i}>{part.replace(/\*/g, "")}</span>;
      })}
    </>
  );
}

function splitReplyChunks(reply: string, replies?: unknown): string[] {
  if (Array.isArray(replies) && replies.length) {
    return replies.map((r) => String(r).trim()).filter(Boolean);
  }
  return String(reply || "")
    .split(/\n\s*\n/)
    .map((c) => c.trim())
    .filter(Boolean);
}

export function ChatFloat({ settings }: ChatFloatProps) {
  const router = useRouter();
  const pathname = usePathname();
  const customer = useCustomerStore((s) => s.customer);
  const addItem = useCartStore((s) => s.addItem);
  const setCoupon = useCartStore((s) => s.setCoupon);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  /** Texto parcial da bolha em digitação (null = nenhuma). */
  const [streaming, setStreaming] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    welcomeMsg(settings.store_name),
  ]);
  const [products, setProducts] = useState<ProductCard[]>([]);
  const [whatsappUrl, setWhatsappUrl] = useState<string | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const loadedForCustomer = useRef<string | null>(null);
  const customerId = customer?.id || null;

  useEffect(() => {
    if (!customerId) {
      loadedForCustomer.current = null;
      setHydrated(true);
      return;
    }
    if (loadedForCustomer.current === customerId) return;
    loadedForCustomer.current = customerId;
    const stored = loadStored(customerId);
    const now = Date.now();
    if (stored && now - stored.updatedAt <= IDLE_MS && stored.messages.length) {
      setMessages(stored.messages);
    } else {
      const next = [welcomeMsg(settings.store_name)];
      setMessages(next);
      saveStored(customerId, next);
    }
    setHydrated(true);
  }, [customerId, settings.store_name]);

  useEffect(() => {
    if (!hydrated || !customerId) return;
    saveStored(customerId, messages);
  }, [messages, customerId, hydrated]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, products, open, busy, showCheckout, streaming]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  /** Animação de digitação — só UI; texto já veio completo da API. */
  async function typeOutBubble(fullText: string) {
    const chars = Array.from(fullText);
    if (!chars.length) {
      setMessages((prev) => [...prev, { role: "assistant", content: fullText }]);
      return;
    }
    setStreaming("");
    let i = 0;
    while (i < chars.length) {
      const step = Math.min(CHAR_BATCH, chars.length - i);
      i += step;
      setStreaming(chars.slice(0, i).join(""));
      await sleep(MS_PER_CHAR * step);
    }
    setMessages((prev) => [...prev, { role: "assistant", content: fullText }]);
    setStreaming(null);
  }

  async function revealAssistantChunks(chunks: string[]) {
    for (let i = 0; i < chunks.length; i++) {
      await sleep(i === 0 ? BEFORE_FIRST_MS : BETWEEN_BUBBLES_MS);
      await typeOutBubble(chunks[i]);
    }
  }

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput("");
    const nextMessages: Msg[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setBusy(true);
    setStreaming(null);
    setWhatsappUrl(null);
    setShowCheckout(false);
    setProducts([]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          customerId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const reply =
        typeof data.reply === "string" && data.reply
          ? data.reply
          : "Não consegui responder agora. Tente de novo ou use o WhatsApp.";

      let addedToCart = false;
      if (Array.isArray(data.cart_actions)) {
        for (const action of data.cart_actions) {
          if (action?.type === "add" && action.product_id && action.size) {
            addItem({
              product_id: String(action.product_id),
              name: String(action.name || "Peça"),
              size: String(action.size) as ProductSize,
              quantity: Number(action.quantity) || 1,
              sale_price: Number(action.sale_price) || 0,
              sale_freight: Number(action.sale_freight) || 0,
              image_url: action.image_url
                ? String(action.image_url)
                : undefined,
            });
            addedToCart = true;
          }
        }
      }

      if (data.coupon?.code && data.coupon?.validation?.ok) {
        setCoupon(
          String(data.coupon.code),
          data.coupon.validation as CouponValidation
        );
      }

      if (Array.isArray(data.products) && data.products.length) {
        setProducts(data.products as ProductCard[]);
      }

      if (data.handoff_whatsapp && data.whatsapp_url) {
        setWhatsappUrl(String(data.whatsapp_url));
      }

      const chunks = splitReplyChunks(reply, data.replies);
      await revealAssistantChunks(chunks.length ? chunks : [reply]);

      if (addedToCart) {
        setShowCheckout(true);
      }
    } catch {
      setStreaming(null);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Falha de conexão. Tente novamente em instantes.",
        },
      ]);
    } finally {
      setStreaming(null);
      setBusy(false);
    }
  }

  function addProduct(p: ProductCard, size: string) {
    const row = p.sizes.find((s) => s.size === size);
    if (!row || row.stock <= 0) return;
    addItem({
      product_id: p.id,
      name: p.name,
      size: size as ProductSize,
      sale_price: p.price,
      sale_freight: 0,
      image_url: p.image_url || undefined,
    });
    setShowCheckout(true);
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: `Adicionei ${p.name} (tam. ${size}) ao carrinho.`,
      },
    ]);
  }

  const goCart = useCallback(() => {
    setOpen(false);
    router.push("/carrinho");
  }, [router]);

  return (
    <>
      {open && (
        <div
          className="fixed bottom-36 right-4 z-50 flex w-[min(100vw-2rem,380px)] flex-col overflow-hidden rounded-2xl border border-[var(--color-primary)]/15 bg-white shadow-2xl md:bottom-24 md:right-6"
          style={{ maxHeight: "min(70vh, 560px)" }}
        >
          <div className="flex items-center justify-between bg-[var(--color-primary)] px-4 py-3 text-white">
            <div>
              <p className="text-sm font-semibold">Consultora LM</p>
              <p className="text-[11px] text-white/80">
                {customerId ? "Histórico salvo na sua conta" : "Chat da loja"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full p-1.5 hover:bg-white/15"
              aria-label="Fechar chat"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto bg-[var(--color-accent)]/40 p-3">
            {messages.map((m, i) => (
              <div
                key={`${m.role}-${i}`}
                className={cn(
                  "max-w-[90%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap",
                  m.role === "user"
                    ? "ml-auto bg-[var(--color-primary)] text-white"
                    : "bg-white text-gray-800 shadow-sm"
                )}
              >
                <ChatText text={m.content} />
              </div>
            ))}

            {streaming !== null && (
              <div className="max-w-[90%] rounded-2xl bg-white px-3 py-2 text-sm leading-relaxed text-gray-800 shadow-sm whitespace-pre-wrap">
                <ChatText text={streaming} />
                <span
                  className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-[var(--color-primary)] align-middle"
                  aria-hidden
                />
              </div>
            )}

            {products.length > 0 && !busy && (
              <div className="space-y-2">
                {products.slice(0, 4).map((p) => (
                  <div
                    key={p.id}
                    className="flex gap-2 rounded-xl bg-white p-2 shadow-sm"
                  >
                    {p.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.image_url}
                        alt=""
                        className="h-16 w-16 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-400">
                        —
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-[var(--color-primary)]">
                        {formatCurrency(p.price)}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {p.sizes
                          .filter((s) => s.stock > 0)
                          .map((s) => (
                            <button
                              key={s.size}
                              type="button"
                              disabled={busy}
                              onClick={() => addProduct(p, s.size)}
                              className="rounded-full border border-[var(--color-primary)]/30 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary)] hover:bg-[var(--color-accent)] disabled:opacity-40"
                            >
                              {s.size}
                            </button>
                          ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!busy && (showCheckout || whatsappUrl) && (
              <div className="flex flex-wrap gap-2">
                {showCheckout && (
                  <button
                    type="button"
                    onClick={goCart}
                    className="rounded-full bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Finalizar compra
                  </button>
                )}
                {whatsappUrl && (
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border border-[#25D366] px-3 py-1.5 text-xs font-semibold text-[#25D366]"
                  >
                    WhatsApp
                  </a>
                )}
              </div>
            )}

            {busy && streaming === null && (
              <p className="text-xs text-gray-400">Consultora digitando…</p>
            )}
            <div ref={bottomRef} />
          </div>

          <form
            className="flex gap-2 border-t bg-white p-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={busy ? "Aguarde a consultora…" : "Ex: tem vestido M?"}
              disabled={busy}
              className="min-w-0 flex-1 rounded-full border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)] disabled:bg-gray-50"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="rounded-full bg-[var(--color-primary)] p-2.5 text-white disabled:opacity-40"
              aria-label="Enviar"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}

      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-36 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-primary)] text-white shadow-lg transition-transform hover:scale-105 active:scale-95 md:bottom-24 md:right-6"
          aria-label="Abrir chat da loja"
          title="Chat da loja"
        >
          <MessageCircle className="h-7 w-7" />
        </button>
      )}
    </>
  );
}
