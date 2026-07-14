"use client";

import { useRef, useState } from "react";
import { uploadStoreAsset } from "@/lib/upload";
import { AdminButton } from "@/components/admin/AdminUI";

interface ImageUploadFieldProps {
  label?: string;
  folder: string;
  value: string;
  onChange: (url: string) => void;
}

export function ImageUploadField({
  label = "Imagem",
  folder,
  value,
  onChange,
}: ImageUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const url = await uploadStoreAsset(file, folder);
      onChange(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no upload");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      {label && <label className="text-sm font-medium text-gray-700">{label}</label>}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={onFile}
          className="text-sm file:mr-2 file:rounded-full file:border-0 file:bg-[var(--color-accent)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[var(--color-primary)]"
        />
        <AdminButton
          type="button"
          variant="secondary"
          onClick={() => inputRef.current?.click()}
          disabled={loading}
        >
          {loading ? "Enviando..." : "Enviar arquivo"}
        </AdminButton>
      </div>
      <input
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="ou cole a URL da imagem"
        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
      />
      {value && (
        <img src={value} alt="" className="h-20 w-28 rounded-lg object-cover ring-1 ring-black/5" />
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
