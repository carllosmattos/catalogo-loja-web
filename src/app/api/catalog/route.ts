import { NextResponse } from "next/server";
import { fetchProductsPage } from "@/lib/catalog";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = Number(searchParams.get("page")) || 1;
  const categoryId = searchParams.get("categoryId") || undefined;
  const { products, total } = await fetchProductsPage({
    page,
    categoryId,
    perPage: 20,
  });
  return NextResponse.json({ products, total });
}
