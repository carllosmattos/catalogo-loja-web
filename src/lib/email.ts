import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/server";
import { appBaseUrl } from "@/lib/payments";
import { formatCurrency, isValidEmail, normalizeEmail } from "@/lib/utils";

const EMAIL_KIND_PAID = "paid" as const;

const BRAND = {
  primary: "#8B0A50",
  secondary: "#D4AF37",
  accent: "#FFF5F8",
  text: "#1a1a1a",
  muted: "#6b7280",
  border: "#f0e4ea",
  white: "#ffffff",
};

function resendClient(): Resend | null {
  const key = (process.env.RESEND_API_KEY || "").trim();
  if (!key) return null;
  return new Resend(key);
}

/** Remetente: domínio verificado ou onboarding@resend.dev (só envia ao e-mail da conta Resend). */
export function emailFrom(): string {
  const from = (process.env.EMAIL_FROM || "").trim();
  if (from) return from;
  return "LM Moda <onboarding@resend.dev>";
}

type PaidEmailItem = {
  product_name: string;
  product_size: string | null;
  quantity: number;
  preco_final_line: number;
};

type PaidEmailPayload = {
  storeName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  whatsappNumber: string | null;
  customerName: string;
  shortId: string;
  total: string;
  orderUrl: string;
  items: PaidEmailItem[];
};

/**
 * Envia e-mail de pagamento aprovado, no máximo 1x por pedido.
 * Nunca lança — falhas são só logadas (não quebra o sync).
 */
export async function sendPaidEmailIfNeeded(orderId: string): Promise<void> {
  try {
    const resend = resendClient();
    if (!resend) {
      console.info("[email] RESEND_API_KEY ausente — skip paid email", orderId);
      return;
    }

    const supabase = await createServiceClient();

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select(
        "id, total_amount, tracking_token, customer_id, customer_name, customer_email, status"
      )
      .eq("id", orderId)
      .maybeSingle();

    if (orderErr || !order) {
      console.error("[email] pedido não encontrado", orderId, orderErr);
      return;
    }

    let to =
      typeof order.customer_email === "string" ? order.customer_email : "";
    if ((!to || !isValidEmail(to)) && order.customer_id) {
      const { data: customer } = await supabase
        .from("customers")
        .select("email")
        .eq("id", order.customer_id)
        .maybeSingle();
      to = typeof customer?.email === "string" ? customer.email : "";
    }

    to = normalizeEmail(to);
    if (!isValidEmail(to)) {
      console.info("[email] sem e-mail válido no pedido", orderId);
      return;
    }

    // Com onboarding@resend.dev o Resend só entrega no e-mail da conta.
    // Em teste, force o destino: EMAIL_TEST_TO=seu@email.com
    const testTo = normalizeEmail(process.env.EMAIL_TEST_TO || "");
    if (isValidEmail(testTo)) {
      console.info("[email] EMAIL_TEST_TO ativo", to, "→", testTo);
      to = testTo;
    }

    const { error: claimErr } = await supabase.from("order_email_log").insert({
      order_id: orderId,
      kind: EMAIL_KIND_PAID,
    });

    if (claimErr) {
      // unique violation → já enviado
      if (
        claimErr.code === "23505" ||
        /duplicate|unique/i.test(claimErr.message || "")
      ) {
        return;
      }
      console.error("[email] claim order_email_log", claimErr);
      return;
    }

    const { data: settings } = await supabase
      .from("store_settings")
      .select(
        "store_name, logo_url, primary_color, secondary_color, accent_color, whatsapp_number"
      )
      .limit(1)
      .maybeSingle();

    const { data: itemRows } = await supabase
      .from("order_items")
      .select("product_name, product_size, quantity, preco_final_line")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    const storeName =
      (typeof settings?.store_name === "string" && settings.store_name) ||
      "LM Moda Feminina";
    const primary =
      (typeof settings?.primary_color === "string" && settings.primary_color) ||
      BRAND.primary;
    const secondary =
      (typeof settings?.secondary_color === "string" &&
        settings.secondary_color) ||
      BRAND.secondary;
    const accent =
      (typeof settings?.accent_color === "string" && settings.accent_color) ||
      BRAND.accent;
    const logoUrl =
      typeof settings?.logo_url === "string" && settings.logo_url.trim()
        ? settings.logo_url.trim()
        : null;
    const whatsapp =
      typeof settings?.whatsapp_number === "string" &&
      settings.whatsapp_number.trim()
        ? settings.whatsapp_number.trim()
        : null;

    const shortId = String(order.id).slice(0, 8).toUpperCase();
    const total = formatCurrency(Number(order.total_amount) || 0);
    const token = String(order.tracking_token || "");
    const orderUrl = token
      ? `${appBaseUrl()}/pedidos/${token}`
      : `${appBaseUrl()}/pedidos`;
    const customerName =
      (typeof order.customer_name === "string" && order.customer_name.trim()) ||
      "Cliente";

    const items: PaidEmailItem[] = (itemRows || []).map((row) => ({
      product_name: String(row.product_name || "Item"),
      product_size:
        row.product_size != null ? String(row.product_size) : null,
      quantity: Number(row.quantity) || 1,
      preco_final_line: Number(row.preco_final_line) || 0,
    }));

    const html = buildPaidEmailHtml({
      storeName,
      logoUrl,
      primaryColor: primary,
      secondaryColor: secondary,
      accentColor: accent,
      whatsappNumber: whatsapp,
      customerName,
      shortId,
      total,
      orderUrl,
      items,
    });

    const { error: sendErr } = await resend.emails.send({
      from: emailFrom(),
      to: [to],
      subject: `${storeName} — pagamento confirmado (#${shortId})`,
      html,
    });

    if (sendErr) {
      console.error("[email] Resend falhou — liberando claim", sendErr);
      await supabase
        .from("order_email_log")
        .delete()
        .eq("order_id", orderId)
        .eq("kind", EMAIL_KIND_PAID);
      return;
    }

    console.info("[email] paid enviado", orderId, to);
  } catch (e) {
    console.error("[email] sendPaidEmailIfNeeded", e);
  }
}

export function buildPaidEmailHtml(p: PaidEmailPayload): string {
  const primary = p.primaryColor || BRAND.primary;
  const secondary = p.secondaryColor || BRAND.secondary;
  const accent = p.accentColor || BRAND.accent;
  const firstName = p.customerName.split(/\s+/)[0] || p.customerName;

  const logoBlock = p.logoUrl
    ? `<img src="${escapeHtml(p.logoUrl)}" alt="${escapeHtml(p.storeName)}" width="72" height="72" style="display:block;margin:0 auto 12px;border-radius:50%;border:2px solid ${secondary};object-fit:cover;" />`
    : `<div style="width:56px;height:56px;margin:0 auto 12px;border-radius:50%;background:${secondary};line-height:56px;text-align:center;font-size:22px;font-weight:700;color:${primary};">LM</div>`;

  const itemRows =
    p.items.length > 0
      ? p.items
          .map((item, i) => {
            const size =
              item.product_size && item.product_size !== "U"
                ? ` · Tam. ${escapeHtml(item.product_size)}`
                : "";
            const border =
              i < p.items.length - 1
                ? `border-bottom:1px solid ${BRAND.border};`
                : "";
            return `
              <tr>
                <td style="padding:12px 0;${border}vertical-align:top;">
                  <p style="margin:0;font-size:14px;font-weight:600;color:${BRAND.text};">
                    ${escapeHtml(item.product_name)}
                  </p>
                  <p style="margin:4px 0 0;font-size:12px;color:${BRAND.muted};">
                    Qtd. ${item.quantity}${size}
                  </p>
                </td>
                <td style="padding:12px 0;${border}vertical-align:top;text-align:right;white-space:nowrap;font-size:14px;font-weight:600;color:${BRAND.text};">
                  ${escapeHtml(formatCurrency(item.preco_final_line))}
                </td>
              </tr>`;
          })
          .join("")
      : `
        <tr>
          <td colspan="2" style="padding:12px 0;font-size:13px;color:${BRAND.muted};">
            Itens do pedido disponíveis no link abaixo.
          </td>
        </tr>`;

  const wa = (p.whatsappNumber || "").replace(/\D/g, "");
  const waBlock = wa
    ? `
      <tr>
        <td align="center" style="padding:0 28px 8px;">
          <p style="margin:0;font-size:13px;color:${BRAND.muted};">
            Dúvidas?
            <a href="https://wa.me/${wa}" style="color:${primary};font-weight:600;text-decoration:none;">
              Fale conosco no WhatsApp
            </a>
          </p>
        </td>
      </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pagamento confirmado</title>
</head>
<body style="margin:0;padding:0;background:${accent};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${accent};padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${BRAND.white};border-radius:20px;overflow:hidden;box-shadow:0 8px 30px rgba(139,10,80,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:${primary};padding:28px 24px 24px;text-align:center;">
              ${logoBlock}
              <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;letter-spacing:0.04em;color:${BRAND.white};font-weight:700;">
                ${escapeHtml(p.storeName)}
              </p>
              <p style="margin:8px 0 0;font-family:system-ui,-apple-system,sans-serif;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:${secondary};">
                Pagamento confirmado
              </p>
            </td>
          </tr>
          <!-- Gold line -->
          <tr>
            <td style="height:3px;background:linear-gradient(90deg,${secondary},${primary},${secondary});font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:28px 28px 8px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${BRAND.text};">
              <p style="margin:0 0 8px;font-size:18px;font-weight:600;">
                Olá, ${escapeHtml(firstName)}!
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${BRAND.muted};">
                Recebemos o pagamento do seu pedido
                <strong style="color:${primary};">#${escapeHtml(p.shortId)}</strong>.
                Obrigada pela compra — estamos preparando tudo com carinho.
              </p>
            </td>
          </tr>
          <!-- Items card -->
          <tr>
            <td style="padding:0 28px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${accent};border-radius:16px;padding:4px 16px;">
                <tr>
                  <td style="padding:16px 4px 4px;">
                    <p style="margin:0;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${primary};font-weight:700;">
                      Resumo do pedido
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 4px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      ${itemRows}
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 4px 16px;border-top:1px solid ${BRAND.border};">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:13px;color:${BRAND.muted};">Total pago</td>
                        <td style="text-align:right;font-size:18px;font-weight:700;color:${primary};">
                          ${escapeHtml(p.total)}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- CTA -->
          <tr>
            <td align="center" style="padding:24px 28px 8px;">
              <a href="${escapeHtml(p.orderUrl)}"
                 style="display:inline-block;background:${primary};color:${BRAND.white};text-decoration:none;padding:14px 28px;border-radius:999px;font-family:system-ui,-apple-system,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.02em;box-shadow:0 4px 14px rgba(139,10,80,0.25);">
                Acompanhar pedido
              </a>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 28px 20px;">
              <p style="margin:0;font-family:system-ui,-apple-system,sans-serif;font-size:11px;line-height:1.5;color:${BRAND.muted};word-break:break-all;">
                Ou abra este link:<br/>
                <a href="${escapeHtml(p.orderUrl)}" style="color:${primary};">${escapeHtml(p.orderUrl)}</a>
              </p>
            </td>
          </tr>
          ${waBlock}
          <!-- Footer -->
          <tr>
            <td style="padding:20px 28px 28px;border-top:1px solid ${BRAND.border};text-align:center;">
              <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:13px;color:${primary};">
                ${escapeHtml(p.storeName)}
              </p>
              <p style="margin:6px 0 0;font-family:system-ui,-apple-system,sans-serif;font-size:11px;color:${BRAND.muted};">
                Moda feminina com carinho · Este e-mail confirma seu pagamento PIX
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
