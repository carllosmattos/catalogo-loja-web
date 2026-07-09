"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const isConfig =
    error.message.includes("Supabase") ||
    error.message.includes("SUPABASE") ||
    error.message.includes("NEXT_PUBLIC");

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FFF5F8] px-4">
      <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
        <h1 className="text-xl font-bold text-[#8B0A50]">
          Erro ao carregar a loja
        </h1>
        {isConfig ? (
          <p className="mt-3 text-sm text-gray-600">
            Configure as variáveis de ambiente no Vercel:{" "}
            <code className="text-xs">NEXT_PUBLIC_SUPABASE_URL</code> e{" "}
            <code className="text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
          </p>
        ) : (
          <p className="mt-3 text-sm text-gray-600">{error.message}</p>
        )}
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-full bg-[#8B0A50] px-6 py-2.5 text-sm font-semibold text-white"
        >
          Tentar novamente
        </button>
      </div>
    </div>
  );
}
