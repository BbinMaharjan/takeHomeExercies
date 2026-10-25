import type { NextRequest } from "next/server";
import { dataset } from "@/lib/dataset";

// Build category map for lookups (slug|type -> Category)
const categoryMap = new Map<string, any>();
for (const cat of dataset.categories) {
  categoryMap.set(`${cat.slug}|${cat.type}`, cat);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  await new Promise((resolve) => setTimeout(resolve, 150));

  if (searchParams.get("simulateFailure") === "true") {
    return new Response(JSON.stringify({ error: "Simulated API failure" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Accept a 'type' query param to filter categories by type
  const typeFilter = searchParams.get("type");

  let categories: any[];
  if (typeFilter) {
    categories = dataset.categories.filter(
      (cat: any) => cat.type === typeFilter && cat.status === true
    );
  } else {
    categories = dataset.categories.filter((cat: any) => cat.status === true);
  }

  // Attach parent category title for UI display
  const enrichedCategories = categories.map((cat: any) => {
    const enriched = {
      ...cat,
      parentTitle: cat.parentId
        ? categoryMap.get(`${cat.parentId}|${cat.type}`)?.title
        : null,
    };
    return enriched;
  });

  return new Response(JSON.stringify({ categories: enrichedCategories }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}