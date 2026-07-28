"use client";

import { Suspense } from "react";
import VendasAdmin from "../VendasAdmin";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-400">Carregando…</p>}>
      <VendasAdmin section="historico" />
    </Suspense>
  );
}
