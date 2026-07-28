import { Suspense } from "react";
import EstoqueAdmin from "../EstoqueAdmin";

export default function AdminEstoquePage() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-400">Carregando…</p>}>
      <EstoqueAdmin />
    </Suspense>
  );
}
