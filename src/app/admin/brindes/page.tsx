"use client";

import { Suspense } from "react";
import BrindesAdmin from "./BrindesAdmin";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-400">Carregando…</p>}>
      <BrindesAdmin section="lista" />
    </Suspense>
  );
}
