"use client";

import { Suspense } from "react";
import FreteAdmin from "../FreteAdmin";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-400">Carregando…</p>}>
      <FreteAdmin section="regras" />
    </Suspense>
  );
}
