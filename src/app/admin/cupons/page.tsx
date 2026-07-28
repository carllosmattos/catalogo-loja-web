"use client";

import { Suspense } from "react";
import CuponsAdmin from "./CuponsAdmin";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-400">Carregando…</p>}>
      <CuponsAdmin section="lista" />
    </Suspense>
  );
}
