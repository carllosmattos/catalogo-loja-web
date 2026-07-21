"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AdminCard } from "@/components/admin/AdminUI";
import { calculateProfit } from "@/lib/profit";
import { formatCurrency } from "@/lib/utils";
import type { Product, Promotion } from "@/types";

type SaleAgg = {
  lucro: number;
  custo_peca?: number;
  custo_brindes?: number;
  preco_final?: number;
  cancelled_at?: string | null;
};

export default function AdminLucroPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [realized, setRealized] = useState({
    lucro: 0,
    receita: 0,
    custo: 0,
    vendas: 0,
  });
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const [{ data: prods }, { data: promos }, { data: sales }] =
        await Promise.all([
          supabase.from("products").select("*").eq("active", true),
          supabase.from("promotions").select("*").eq("active", true),
          supabase
            .from("sales")
            .select("lucro, custo_peca, custo_brindes, preco_final, cancelled_at")
            .is("cancelled_at", null),
        ]);
      setProducts(prods || []);
      setPromotions(promos || []);
      const rows = (sales || []) as SaleAgg[];
      const lucro = rows.reduce((s, row) => s + Number(row.lucro || 0), 0);
      const receita = rows.reduce(
        (s, row) => s + Number(row.preco_final || 0),
        0
      );
      const custo = rows.reduce(
        (s, row) =>
          s + Number(row.custo_peca || 0) + Number(row.custo_brindes || 0),
        0
      );
      setRealized({
        lucro,
        receita,
        custo,
        vendas: rows.length,
      });
    }
    load();
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-primary)]">
        Lucro & Margem
      </h1>

      <AdminCard title="Lucro realizado (vendas)">
        <p className="mb-2 text-xs text-gray-500">
          Valores congelados no momento de cada venda. Alterar preço ou custo no
          cadastro do produto não muda o histórico.
        </p>
        <p className="text-3xl font-bold text-[var(--color-primary)]">
          {formatCurrency(realized.lucro)}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
          <div>
            <p className="text-gray-400">Receita</p>
            <p className="font-semibold">{formatCurrency(realized.receita)}</p>
          </div>
          <div>
            <p className="text-gray-400">Custo (peça + brindes)</p>
            <p className="font-semibold">{formatCurrency(realized.custo)}</p>
          </div>
          <div>
            <p className="text-gray-400">Vendas</p>
            <p className="font-semibold">{realized.vendas}</p>
          </div>
        </div>
      </AdminCard>

      <AdminCard title="Simulação por produto (cadastro atual)" className="mt-6">
        <p className="mb-3 text-xs text-gray-500">
          Estimativa se você vender hoje com os preços e custos atuais do
          cadastro. Não substitui o lucro realizado acima.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2">Produto</th>
                <th className="pb-2">Preço</th>
                <th className="pb-2">Lucro est.</th>
                <th className="pb-2">Margem</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const profit = calculateProfit(p, [], promotions);
                return (
                  <tr key={p.id} className="border-b">
                    <td className="py-2">{p.name}</td>
                    <td>{formatCurrency(profit.preco_final_cliente)}</td>
                    <td>{formatCurrency(profit.lucro_bruto)}</td>
                    <td>{profit.margem_percent.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </AdminCard>
    </div>
  );
}
