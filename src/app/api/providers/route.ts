import type { NextRequest } from "next/server";
import { dataset } from "@/lib/dataset";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  await new Promise((resolve) => setTimeout(resolve, 150));

  if (searchParams.get("simulateFailure") === "true") {
    return new Response(JSON.stringify({ error: "Simulated API failure" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Filter by city and/or country if provided
  const city = searchParams.get("city");
  const country = searchParams.get("country");

  let providers: any[] = dataset.providers.filter(
    (p: any) => p.status === "active"
  );

  if (city) {
    providers = providers.filter(
      (p: any) => p.providerInformation.city.slug === city
    );
  }

  if (country) {
    providers = providers.filter(
      (p: any) => p.providerInformation.country.alphaCode === country
    );
  }

  // Sort by name for consistent UI
  providers.sort((a: any, b: any) => a.name.localeCompare(b.name));

  return new Response(JSON.stringify({ providers }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}