"use client";

import { Suspense } from "react";
import PromocoesAdmin from "./PromocoesAdmin";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-400">Carregando…</p>}>
      <PromocoesAdmin section="lista" />
    </Suspense>
  );
}
