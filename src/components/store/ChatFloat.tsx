"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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

interface ChatFloatProps {
  settings: StoreSettings;
}

export function ChatFloat({ settings }: ChatFloatProps) {
  const router = useRouter();
  const customer = useCustomerStore((s) => s.customer);
  const addItem = useCartStore((s) => s.addItem);
  const setCoupon = useCartStore((s) => s.setCoupon);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content: `Olá! Sou a consultora da ${settings.store_name}. Posso ajudar a achar uma peça, ver tamanhos ou cupom 😊`,
    },
  ]);
  const [products, setProducts] = useState<ProductCard[]>([]);
  const [whatsappUrl, setWhatsappUrl] = useState<string | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, products, open]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput("");
    const nextMessages: Msg[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setBusy(true);
    setWhatsappUrl(null);
    setShowCheckout(false);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          customerId: customer?.id || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const reply =
        typeof data.reply === "string" && data.reply
          ? data.reply
          : "Não consegui responder agora. Tente de novo ou use o WhatsApp.";

      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);

      if (Array.isArray(data.products) && data.products.length) {
        setProducts(data.products as ProductCard[]);
      }

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
            setShowCheckout(true);
          }
        }
      }

      if (data.coupon?.code && data.coupon?.validation?.ok) {
        setCoupon(
          String(data.coupon.code),
          data.coupon.validation as CouponValidation
        );
      }

      if (data.handoff_whatsapp && data.whatsapp_url) {
        setWhatsappUrl(String(data.whatsapp_url));
      }
      if (data.go_checkout) setShowCheckout(true);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Falha de conexão. Tente novamente em instantes.",
        },
      ]);
    } finally {
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
        content: `Adicionei ${p.name} (tam. ${size}) ao carrinho. Quer ir para o pagamento?`,
      },
    ]);
  }

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
              <p className="text-[11px] text-white/80">Chat da loja</p>
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
                  "max-w-[90%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                  m.role === "user"
                    ? "ml-auto bg-[var(--color-primary)] text-white"
                    : "bg-white text-gray-800 shadow-sm"
                )}
              >
                {m.content}
              </div>
            ))}

            {products.length > 0 && (
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
                              onClick={() => addProduct(p, s.size)}
                              className="rounded-full border border-[var(--color-primary)]/30 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary)] hover:bg-[var(--color-accent)]"
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

            {(showCheckout || whatsappUrl) && (
              <div className="flex flex-wrap gap-2">
                {showCheckout && (
                  <button
                    type="button"
                    onClick={() => router.push("/checkout")}
                    className="rounded-full bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Ir para o pagamento
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

            {busy && (
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
              placeholder="Ex: tem vestido M?"
              disabled={busy}
              className="min-w-0 flex-1 rounded-full border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]"
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

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-36 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-primary)] text-white shadow-lg transition-transform hover:scale-105 active:scale-95 md:bottom-24 md:right-6"
        aria-label={open ? "Fechar chat" : "Abrir chat da loja"}
        title="Chat da loja"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-7 w-7" />}
      </button>
    </>
  );
}
