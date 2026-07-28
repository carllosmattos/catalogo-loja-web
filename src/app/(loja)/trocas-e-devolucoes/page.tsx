import { fetchStoreSettings } from "@/lib/catalog";
import { StoreHeader } from "@/components/store/StoreHeader";
import { STORE_MAIN } from "@/lib/store-layout";
import Link from "next/link";

export default async function TrocasDevolucoesPage() {
  const settings = await fetchStoreSettings();
  const addr = [
    settings.sender_street,
    settings.sender_number,
    settings.sender_complement,
    settings.sender_neighborhood,
    settings.sender_city,
    settings.sender_state,
    settings.sender_zip,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <StoreHeader storeName={settings.store_name} logoUrl={settings.logo_url} />
      <main className={STORE_MAIN}>
        <div className="mx-auto max-w-2xl space-y-6 text-sm text-gray-700">
          <Link href="/" className="text-[var(--color-primary)]">
            ← Início
          </Link>
          <h1 className="text-2xl font-bold text-[var(--color-primary)]">
            Trocas e devoluções
          </h1>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">
              Direito de arrependimento
            </h2>
            <p>
              Em compras online, você pode desistir em até{" "}
              <strong>7 dias corridos</strong> após o{" "}
              <strong>recebimento</strong> do produto, sem precisar justificar
              (Código de Defesa do Consumidor, art. 49).
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">
              Como funciona o reembolso
            </h2>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Solicite o reembolso no pedido (escolha o motivo).</li>
              <li>
                Envie a peça de volta nas mesmas condições em que recebeu
                (sem uso indevido, com etiquetas quando houver).
              </li>
              <li>
                Assim que recebermos e conferirmos o produto, aprovamos o
                estorno no Mercado Pago.
              </li>
            </ol>
            <p className="rounded-xl bg-[var(--color-accent)]/60 px-3 py-2 text-gray-800">
              <strong>Importante:</strong> o dinheiro só é estornado{" "}
              <strong>depois</strong> que a loja recebe e confere a peça. Não
              aprove o reembolso mentalmente antes de devolver.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">
              Frete de devolução
            </h2>
            <p>
              No direito de arrependimento e em pedidos por “outro motivo”, o{" "}
              <strong>frete de devolução é por conta do cliente</strong>. A loja
              não reembolsa esse envio.
            </p>
            <p>
              Se o produto veio com <strong>defeito</strong>, errado ou
              avariado na entrega, informe no motivo da solicitação — nesses
              casos o frete de retorno pode ser da loja, após análise.
            </p>
          </section>

          {addr && (
            <section className="space-y-2">
              <h2 className="text-base font-semibold text-gray-900">
                Endereço para devolução
              </h2>
              <p className="rounded-xl border border-gray-100 bg-white p-3">
                {settings.store_name}
                <br />
                {addr}
              </p>
              <p className="text-xs text-gray-500">
                Use esse endereço no envio de retorno. Guarde o comprovante.
              </p>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">
              Produto com defeito
            </h2>
            <p>
              Se houver vício (defeito), produto errado ou dano no transporte,
              entre em contato e solicite o reembolso com o motivo adequado.
              Podemos pedir fotos para agilizar.
            </p>
          </section>

          {settings.whatsapp_number && (
            <p className="text-xs text-gray-500">
              Dúvidas? Fale conosco pelo WhatsApp cadastrado na loja.
            </p>
          )}
        </div>
      </main>
    </>
  );
}
