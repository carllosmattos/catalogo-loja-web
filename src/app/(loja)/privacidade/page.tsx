import { fetchStoreSettings } from "@/lib/catalog";
import { StoreHeader } from "@/components/store/StoreHeader";
import { STORE_MAIN } from "@/lib/store-layout";
import Link from "next/link";

export default async function PrivacidadePage() {
  const settings = await fetchStoreSettings();

  return (
    <>
      <StoreHeader storeName={settings.store_name} logoUrl={settings.logo_url} />
      <main className={STORE_MAIN}>
        <div className="mx-auto max-w-2xl space-y-6 text-sm text-gray-700">
          <Link href="/" className="text-[var(--color-primary)]">
            ← Início
          </Link>
          <h1 className="text-2xl font-bold text-[var(--color-primary)]">
            Política de privacidade
          </h1>
          <p className="text-xs text-gray-500">
            Última atualização: agosto de 2026. Esta política explica como a{" "}
            <strong>{settings.store_name}</strong> trata dados pessoais no site,
            em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei
            nº 13.709/2018).
          </p>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">
              1. Quem é responsável
            </h2>
            <p>
              O controlador dos dados é a loja <strong>LM moda feminina</strong>
              , pessoa física que opera este site de comércio eletrônico.
            </p>
            <p>
              <strong>Encarregado (DPO):</strong> Carlos Eduardo Vieira de Matos
              <br />
              <strong>E-mail:</strong>{" "}
              <a
                href="mailto:mattostech@yahoo.com"
                className="text-[var(--color-primary)] underline"
              >
                mattostech@yahoo.com
              </a>
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">
              2. Quais dados coletamos
            </h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Nome, CPF, telefone e e-mail</li>
              <li>Endereço de entrega</li>
              <li>Dados do pedido, pagamento e frete</li>
              <li>
                Mensagens do chat da loja (quando você usa o atendimento no
                site)
              </li>
              <li>
                Dados técnicos básicos de acesso (ex.: IP, navegador), quando
                gerados pela hospedagem
              </li>
            </ul>
            <p>
              Não pedimos dados sensíveis além do necessário para vender e
              entregar.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">
              3. Para que usamos
            </h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Identificar a cliente e processar a compra (PIX)</li>
              <li>Calcular frete e enviar o pedido</li>
              <li>
                Enviar atualizações do pedido (e-mail e/ou WhatsApp, quando
                aplicável)
              </li>
              <li>Atender dúvidas pelo chat, WhatsApp ou e-mail</li>
              <li>Cumprir obrigações legais e prevenir fraudes</li>
            </ul>
            <p>
              A base legal típica é a execução do contrato de compra e venda e,
              quando necessário, legítimo interesse ou cumprimento de obrigação
              legal.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">
              4. Com quem compartilhamos
            </h2>
            <p>
              Só compartilhamos o necessário para operar a loja, com
              prestadores que atuam em nosso nome ou para concluir a compra:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Supabase</strong> — armazenamento dos dados do site
              </li>
              <li>
                <strong>Vercel</strong> — hospedagem do site
              </li>
              <li>
                <strong>Mercado Pago</strong> — pagamento PIX
              </li>
              <li>
                <strong>Resend</strong> — envio de e-mails transacionais (quando
                ativo)
              </li>
              <li>
                <strong>OpenRouter / provedores de IA</strong> — funcionamento do
                chat da loja (quando ativo)
              </li>
              <li>
                <strong>Melhor Envio / transportadoras</strong> — cotação e
                envio (quando utilizado)
              </li>
            </ul>
            <p>
              Não vendemos nem alugamos sua lista de contatos para marketing de
              terceiros.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">
              5. Por quanto tempo guardamos
            </h2>
            <p>
              Mantemos os dados pelo tempo necessário para cumprir o pedido,
              atender suporte, obrigações fiscais/contábeis e eventuais
              reclamações. Depois disso, podemos anonimizar ou excluir, quando
              aplicável.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">
              6. Seus direitos (LGPD)
            </h2>
            <p>Você pode solicitar, entre outros:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Confirmação de tratamento e acesso aos dados</li>
              <li>Correção de dados incompletos ou desatualizados</li>
              <li>Anonimização, bloqueio ou exclusão, quando cabível</li>
              <li>Informação sobre compartilhamentos</li>
              <li>Revogação de consentimento, quando o tratamento se basear nele</li>
            </ul>
            <p>
              Para exercer esses direitos, escreva para{" "}
              <a
                href="mailto:mattostech@yahoo.com"
                className="text-[var(--color-primary)] underline"
              >
                mattostech@yahoo.com
              </a>
              . Respondemos em prazo razoável (em geral até 15 dias úteis).
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">
              7. Segurança
            </h2>
            <p>
              Usamos acesso restrito ao painel administrativo, conexão HTTPS e
              serviços com práticas de segurança próprias. Nenhum sistema é
              100% livre de risco; em caso de incidente relevante, adotaremos
              medidas adequadas de comunicação quando exigido.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">
              8. Cookies e tecnologias semelhantes
            </h2>
            <p>
              O site pode usar armazenamento local (ex.: carrinho e histórico do
              chat no seu aparelho) e cookies técnicos necessários ao
              funcionamento. Não usamos, neste texto, a promessa de cookies de
              publicidade de terceiros além do que a plataforma eventualmente
              aplicar.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">
              9. Alterações
            </h2>
            <p>
              Podemos atualizar esta política. A versão vigente fica sempre
              nesta página, com a data de atualização no topo.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">
              10. Contato
            </h2>
            <p>
              Dúvidas sobre privacidade:{" "}
              <a
                href="mailto:mattostech@yahoo.com"
                className="text-[var(--color-primary)] underline"
              >
                mattostech@yahoo.com
              </a>
              {settings.whatsapp_number
                ? " ou pelo WhatsApp da loja."
                : "."}
            </p>
          </section>

          <p className="border-t border-gray-100 pt-4 text-xs text-gray-400">
            <Link href="/trocas-e-devolucoes" className="underline">
              Trocas e devoluções
            </Link>
            {" · "}
            <Link href="/" className="underline">
              Início
            </Link>
          </p>
        </div>
      </main>
    </>
  );
}
