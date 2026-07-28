"use client";

import { Suspense } from "react";
import LojaAdmin from "../LojaAdmin";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-400">Carregando…</p>}>
      <LojaAdmin section="banners" />
    </Suspense>
  );
}
