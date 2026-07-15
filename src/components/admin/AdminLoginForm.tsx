"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface AdminLoginFormProps {
  logoUrl: string;
  storeName: string;
}

export function AdminLoginForm({ logoUrl, storeName }: AdminLoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }
    router.push("/admin/produtos");
    router.refresh();
  }

  return (
    <div className="flex min-h-dvh w-full items-center justify-center px-4 py-8">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <img
            src={logoUrl}
            alt={storeName}
            className="mb-3 h-16 w-auto object-contain"
          />
          <h1 className="text-xl font-bold text-[var(--color-primary)]">
            Admin — Login
          </h1>
        </div>
        {error && (
          <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="mt-4 space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="E-mail"
            className="w-full rounded-xl border px-4 py-3 text-sm"
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Senha"
            className="w-full rounded-xl border px-4 py-3 text-sm"
            required
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded-full bg-[var(--color-primary)] py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
