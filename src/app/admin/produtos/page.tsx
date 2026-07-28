"use client";

import { Suspense } from "react";
import ProdutosAdmin from "./ProdutosAdmin";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-400">Carregando…</p>}>
      <ProdutosAdmin section="lista" />
    </Suspense>
  );
}
