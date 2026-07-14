import { createClient } from "@/lib/supabase/client";

/**
 * Upload autenticado para o bucket público store-assets.
 * Retorna a URL pública do arquivo.
 */
export async function uploadStoreAsset(
  file: File,
  folder: string
): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Faça login no admin para enviar imagens.");

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${folder.replace(/\/+$/, "")}/${crypto.randomUUID()}.${ext || "jpg"}`;

  const { error } = await supabase.storage
    .from("store-assets")
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "image/jpeg",
    });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from("store-assets").getPublicUrl(path);
  return data.publicUrl;
}
