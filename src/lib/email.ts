import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/server";
import { appBaseUrl } from "@/lib/payments";
import { formatCurrency, isValidEmail, normalizeEmail } from "@/lib/utils";

const EMAIL_KIND_PAID = "paid" as const;

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
      .select("store_name")
      .limit(1)
      .maybeSingle();

    const storeName =
      (typeof settings?.store_name === "string" && settings.store_name) ||
      "LM Moda Feminina";

    const shortId = String(order.id).slice(0, 8).toUpperCase();
    const total = formatCurrency(Number(order.total_amount) || 0);
    const token = String(order.tracking_token || "");
    const orderUrl = token
      ? `${appBaseUrl()}/pedidos/${token}`
      : `${appBaseUrl()}/pedidos`;
    const customerName =
      (typeof order.customer_name === "string" && order.customer_name.trim()) ||
      "Cliente";

    const html = `
<!DOCTYPE html>
<html>
<body style="font-family:system-ui,sans-serif;color:#1a1a1a;line-height:1.5;max-width:520px;margin:0 auto;padding:24px;">
  <h1 style="font-size:20px;color:#8B0A50;margin:0 0 12px;">${escapeHtml(storeName)}</h1>
  <p>Olá, ${escapeHtml(customerName)}!</p>
  <p>Recebemos o pagamento do seu pedido <strong>#${escapeHtml(shortId)}</strong>.</p>
  <p style="font-size:18px;margin:16px 0;"><strong>Total: ${escapeHtml(total)}</strong></p>
  <p>
    <a href="${escapeHtml(orderUrl)}"
       style="display:inline-block;background:#8B0A50;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600;">
      Ver pedido
    </a>
  </p>
  <p style="font-size:12px;color:#666;margin-top:24px;">
    Se o botão não funcionar, acesse:<br/>
    <a href="${escapeHtml(orderUrl)}">${escapeHtml(orderUrl)}</a>
  </p>
</body>
</html>`.trim();

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
