"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AdminCard } from "@/components/admin/AdminUI";
import { calculateProfit } from "@/lib/profit";
import { formatCurrency } from "@/lib/utils";
import type { Product, Promotion } from "@/types";

export default function AdminLucroPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [salesTotal, setSalesTotal] = useState(0);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const [{ data: prods }, { data: promos }, { data: sales }] = await Promise.all([
        supabase.from("products").select("*").eq("active", true),
        supabase.from("promotions").select("*").eq("active", true),
        supabase.from("sales").select("lucro, cancelled_at").is("cancelled_at", null),
      ]);
      setProducts(prods || []);
      setPromotions(promos || []);
      setSalesTotal(
        (sales || []).reduce((s, row) => s + Number(row.lucro || 0), 0)
      );
    }
    load();
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-primary)]">Lucro & Margem</h1>
      <AdminCard title="Lucro realizado (vendas)">
        <p className="text-3xl font-bold text-[var(--color-primary)]">
          {formatCurrency(salesTotal)}
        </p>
      </AdminCard>
      <AdminCard title="Simulação por produto" className="mt-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2">Produto</th>
                <th className="pb-2">Preço</th>
                <th className="pb-2">Lucro</th>
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
