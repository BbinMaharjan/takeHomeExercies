import type { NextRequest } from "next/server";
import { dataset } from "@/lib/dataset";
import type { Service, Category, SubCategory } from "@/types/domain";
import { parseMoney } from "@/lib/pricing/calculate";

const providerMap = new Map(dataset.providers.map((p) => [p.id, p]));
const categoryMap = new Map<string, Category | SubCategory>();
for (const cat of dataset.categories) {
  // flatten categories including children
  categoryMap.set(cat.id, cat);
  for (const child of cat.children || []) {
    categoryMap.set(child.id, child);
  }
}

function isVisible(svc: Service): boolean {
  if (!svc.status) return false;
  const provider = providerMap.get(svc.userId);
  if (!provider || provider.status !== "active") return false;
  if (svc.categoryId) {
    const category = categoryMap.get(svc.categoryId);
    if (category && !category.status) return false;
  }
  return true;
}

function servicePrice(svc: Service): number | null {
  if (svc.type === "wellness") {
    const prices = svc.wellnessPricing
      .map((o) => parseMoney(o.price))
      .filter((n): n is number => n != null);
    if (prices.length === 0) return null;
    return Math.min(...prices);
  }
  return parseMoney(svc.price);
}

interface Filters {
  serviceType?: string[];
  categorySlug?: string;
  categoryType?: string;
  providerIds?: number[];
  city?: string;
  country?: string;
  priceMin?: number;
  priceMax?: number;
  priceCurrency?: string;
  availableAsHomeTest?: boolean;
  freeText?: string;
}
function matchesFilters(svc: Service, filters: Filters, selectedCurrency?: string | null) {
  if (filters.serviceType && filters.serviceType.length > 0) {
    if (!filters.serviceType.includes(svc.type)) return false;
  }

  if (filters.categorySlug && filters.categoryType) {
    // category filter by slug+type
    const cat = dataset.categories.find(
      (c: Category) => c.slug === filters.categorySlug && c.type === filters.categoryType,
    );
    // also search children
    let match = false;
    if (cat && svc.categoryId === cat.id) match = true;
    if (!match) {
      // check subcategory
      for (const c of dataset.categories) {
        for (const ch of c.children || []) {
          if (ch.slug === filters.categorySlug && ch.type === filters.categoryType && svc.categoryId === ch.id) {
            match = true;
          }
        }
      }
    }
    if (!match) return false;
  }

  if (filters.providerIds && filters.providerIds.length > 0) {
    if (!filters.providerIds.includes(svc.userId)) return false;
  }

  const provider = providerMap.get(svc.userId);
  if (filters.city && provider?.providerInformation.city.slug !== filters.city) return false;
  if (filters.country && provider?.providerInformation.country.alphaCode !== filters.country) return false;

  // price range
  const priceFilterActive =
    filters.priceMin != null || filters.priceMax != null || filters.priceCurrency;
  if (priceFilterActive) {
    const currency = provider?.providerInformation.currency;
    if (filters.priceCurrency && currency !== filters.priceCurrency) {
      if (filters.priceMin != null || filters.priceMax != null) return false;
    }
    if (filters.priceMin != null || filters.priceMax != null) {
      const price = servicePrice(svc);
      if (price == null) return false;
      if (filters.priceMin != null && price < filters.priceMin) return false;
      if (filters.priceMax != null && price > filters.priceMax) return false;
    }
  }

  if (filters.availableAsHomeTest != null) {
    if (svc.testAtHome !== filters.availableAsHomeTest) return false;
  }

  if (filters.freeText) {
    const term = filters.freeText.toLowerCase();
    const providerName = provider?.providerInformation.companyName ?? "";
    const haystack = [svc.title, providerName].join(" ").toLowerCase();
    // category title
    const cat = svc.categoryId ? categoryMap.get(svc.categoryId) : null;
    const catTitle = cat?.title ?? "";
    if (![svc.title, providerName, catTitle].some((v) => v.toLowerCase().includes(term))) {
      return false;
    }
  }

  return true;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  await new Promise((resolve) => setTimeout(resolve, 200));

  if (searchParams.get("simulateFailure") === "true") {
    return new Response(JSON.stringify({ error: "Simulated API failure" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse filters
  const filters: Filters = {};
  const typeVals = searchParams.getAll("type");
  if (typeVals.length > 0) filters.serviceType = typeVals;
  // also service_type
  const st = searchParams.get("service_type");
  if (st) filters.serviceType = st.split(",");

  const catSlug = searchParams.get("categoryId") || searchParams.get("category");
  const catType = searchParams.get("categoryType");
  if (catSlug && catType) {
    filters.categorySlug = catSlug;
    filters.categoryType = catType;
  }

  const provVals = searchParams.getAll("providerId");
  if (provVals.length > 0) filters.providerIds = provVals.map((v) => parseInt(v, 10)).filter((n) => !isNaN(n));
  const prov = searchParams.get("provider");
  if (prov) filters.providerIds = prov.split(",").map((v) => parseInt(v, 10)).filter((n) => !isNaN(n));

  const city = searchParams.get("city");
  if (city) filters.city = city;
  const country = searchParams.get("country");
  if (country) filters.country = country;

  const priceMin = searchParams.get("priceMin");
  if (priceMin) filters.priceMin = parseFloat(priceMin);
  const priceMax = searchParams.get("priceMax");
  if (priceMax) filters.priceMax = parseFloat(priceMax);

  const homeTest = searchParams.get("availableAsHomeTest") || searchParams.get("testAtHome");
  if (homeTest) filters.availableAsHomeTest = homeTest === "true";

  const q = searchParams.get("q") || searchParams.get("search");
  if (q) filters.freeText = q;

  const currency = searchParams.get("currency");
  const selectedCurrency = currency || null;

  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = Math.min(Math.max(parseInt(searchParams.get("pageSize") || "10", 10) || 10, 1), 10000);
  const sortBy = (searchParams.get("sortBy") || searchParams.get("sort") || "relevance") as string;
  const sortDir = (searchParams.get("sortDir") || "asc") as string;

  // Filter
  const results = dataset.services.filter((svc) => {
    if (!isVisible(svc)) return false;
    return matchesFilters(svc, filters, selectedCurrency);
  });

  // Sort
  results.sort((a, b) => {
    let comparison = 0;
    const priceA = servicePrice(a);
    const priceB = servicePrice(b);
    switch (sortBy) {
      case "priceLow":
        comparison = (priceA ?? Infinity) - (priceB ?? Infinity);
        break;
      case "priceHigh":
        comparison = (priceB ?? -Infinity) - (priceA ?? -Infinity);
        break;
      case "rating": {
        const ra = providerMap.get(a.userId)?.providerInformation.rating ?? 0;
        const rb = providerMap.get(b.userId)?.providerInformation.rating ?? 0;
        comparison = rb - ra;
        break;
      }
      case "relevance":
      default: {
        const term = (filters.freeText || "").toLowerCase();
        if (term) {
          const aTitle = a.title.toLowerCase().includes(term);
          const bTitle = b.title.toLowerCase().includes(term);
          if (aTitle && !bTitle) comparison = -1;
          else if (!aTitle && bTitle) comparison = 1;
          else comparison = a.id.localeCompare(b.id);
        } else {
          comparison = a.id.localeCompare(b.id);
        }
        break;
      }
    }
    if (comparison === 0) comparison = a.id.localeCompare(b.id);
    if (sortDir === "desc" && sortBy !== "priceHigh" && sortBy !== "rating" && sortBy !== "relevance") {
      comparison = -comparison;
    }
    return comparison;
  });

  const total = results.length;
  const start = (page - 1) * pageSize;
  const paginated = results.slice(start, start + pageSize);

  return new Response(
    JSON.stringify({
      services: paginated,
      total,
      page,
      pageSize,
      filters: { ...filters, selectedCurrency },
    }),
    { headers: { "Content-Type": "application/json" }, status: 200 },
  );
}
