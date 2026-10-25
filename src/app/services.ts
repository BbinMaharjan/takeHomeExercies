/**
 * Service Explorer — Data types and utilities.
 * 
 * Framework-independent module for Vitest testing.
 * Does NOT import Next.js, TanStack Query, or Ant Design.
 */

// ---------------------------------------------------------------------------
// Domain models
// ---------------------------------------------------------------------------

export interface City {
  id: string;
  name: string;
  slug: string;
}

export interface Country {
  id: number;
  name: string;
  alphaCode: string;
}

export interface ProviderInformation {
  companyName: string;
  slug: string;
  types: string[];
  currency: "THB" | "NPR" | "INR";
  city: City;
  country: Country;
}

export interface Category {
  id: string;
  title: string;
  slug: string;
  type: "package" | "lab_test" | "service" | "wellness" | "insurance";
  position: number;
  status: boolean;
  parentId: string | null;
  children: Category[];
}

export interface Provider {
  id: number;
  name: string;
  status: "active" | "inactive";
  providerInformation: ProviderInformation;
  services: Service[];
}

export interface ServicePriceDetails {
  basePrice: number | null;
  discountType: "percent" | "fixed" | null;
  discount: number;
  serviceChargeType: "percent" | "fixed" | null;
  serviceCharge: number;
  wellnessPricing: WellnessPriceOption[];
}

export interface WellnessPriceOption {
  durationMin: number;
  price: number;
  display: string;
}

export interface Service {
  id: string;
  title: string;
  description: string | null;
  type: "package" | "lab_test" | "service" | "wellness" | "insurance";
  status: boolean;
  category: Category | null;
  prices: ServicePriceDetails;
  providerId: number;
  isVisible: boolean;
  matchScore: number;
}

// ---------------------------------------------------------------------------
// Data normalization
// ---------------------------------------------------------------------------

/**
 * Load and normalize the raw JSON dataset.
 * Returns { categories, providers, services }.
 * Category identity uses (slug + type) as key, not slug alone.
 */
export function loadDataset(raw: any) {
  const categoriesRaw = raw.categories || [];
  const providersRaw = raw.providers || [];
  const servicesRaw = raw.services || [];

  const categoryMap = new Map<string, Category>();
  const categoryById = new Map<string, Category>();

  function registerCategory(cat: any): Category {
    const existing = categoryById.get(cat.id);
    if (existing) return existing;

    const normalized: Category = {
      id: cat.id,
      title: cat.title,
      slug: cat.slug,
      type: cat.type,
      position: cat.position,
      status: !!cat.status,
      parentId: cat.parentId ?? null,
      children: [],
    };
    categoryMap.set(`${normalized.slug}|${normalized.type}`, normalized);
    categoryById.set(normalized.id, normalized);

    for (const child of cat.children || []) {
      registerCategory(child);
    }
    return normalized;
  }

  for (const cat of categoriesRaw) {
    registerCategory(cat);
  }

  // Attach children to parents
  for (const cat of categoryMap.values()) {
    cat.children = [];
  }
  for (const cat of categoryMap.values()) {
    if (cat.parentId) {
      const parent = categoryById.get(cat.parentId);
      if (parent) parent.children.push(cat);
    }
  }

  const providers: Provider[] = [];
  const providerMap = new Map<number, Provider>();

  for (const prov of providersRaw) {
    const pi: ProviderInformation = {
      companyName: prov.providerInformation.companyName,
      slug: prov.providerInformation.slug,
      types: prov.providerInformation.types,
      currency: prov.providerInformation.currency,
      city: {
        id: prov.providerInformation.city.id,
        name: prov.providerInformation.city.name,
        slug: prov.providerInformation.city.slug,
      },
      country: {
        id: prov.providerInformation.country.id,
        name: prov.providerInformation.country.name,
        alphaCode: prov.providerInformation.country.alphaCode,
      },
    };
    const provider: Provider = {
      id: prov.id,
      name: prov.name,
      status: prov.status,
      providerInformation: pi,
      services: [],
    };
    providers.push(provider);
    providerMap.set(provider.id, provider);
  }

  const services: Service[] = [];
  for (const svc of servicesRaw) {
    const priceDetails = parseServicePrices(svc.prices);
    const catId = svc.categoryId;
    const category = catId ? (categoryById.get(catId) ?? null) : null;
    const isVisible = computeServiceVisibility(svc, categoryById, providerMap);

    const service: Service = {
      id: svc.id,
      title: svc.title,
      description: svc.description,
      type: svc.type,
      status: !!svc.status,
      category: category,
      prices: priceDetails,
      providerId: svc.providerId,
      isVisible,
      matchScore: 0,
    };
    services.push(service);
  }

  // Attach services to providers
  for (const svc of services) {
    const prov = providerMap.get(svc.providerId);
    if (prov) prov.services.push(svc);
  }

  return {
    categories: [...categoryMap.values()],
    providers,
    services,
  };
}

function computeServiceVisibility(
  svc: any,
  catById: Map<string, Category>,
  provMap: Map<number, Provider>
): boolean {
  if (!svc.status) return false;
  const prov = provMap.get(svc.providerId);
  if (!prov || prov.status !== "active") return false;
  const catId = svc.categoryId ?? svc.category?.id;
  if (catId) {
    const category = catById.get(catId);
    if (category && !category.status) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Price parsing
// ---------------------------------------------------------------------------

function parseServicePrices(rawPrices: any): ServicePriceDetails {
  const details: ServicePriceDetails = {
    basePrice: null,
    discountType: null,
    discount: 0,
    serviceChargeType: null,
    serviceCharge: 0,
    wellnessPricing: [],
  };

  if (!rawPrices) return details;

  if (rawPrices.pricingOptions && Array.isArray(rawPrices.pricingOptions)) {
    for (const opt of rawPrices.pricingOptions) {
      const price = parsePriceString(opt.price);
      if (price == null) continue; // skip options without valid price
      details.wellnessPricing.push({
        durationMin: parseDurationMinutes(opt.duration),
        price,
        display: formatWellnessPrice(opt.duration, price),
      });
    }
    if (details.wellnessPricing.length > 0) {
      const lowest = details.wellnessPricing.reduce(
        (a: any, b: any) => (a.price < b.price ? a : b),
        details.wellnessPricing[0]
      );
      details.basePrice = lowest.price;
    }
    return details;
  }

  const price = rawPrices.price ? rawPrices.price.replace(/[^\d,]/g, "").replace(/,/g, "") : "";
  details.basePrice = price ? parseInt(price, 10) : null;
  details.discountType = rawPrices.discountType;
  details.discount = rawPrices.discount != null ? parseFloat(rawPrices.discount) : 0;
  const scType = rawPrices.serviceChargeType;
  details.serviceChargeType = scType;
  details.serviceCharge = scType != null ? parseFloat(rawPrices.serviceCharge) : 0;
  return details;
}

function parsePriceString(priceStr: string | null | undefined): number | null {
  if (!priceStr) return null;
  const cleaned = priceStr.replace(/[^\d,]/g, "").replace(/,/g, "");
  const num = parseFloat(cleaned);
  return isFinite(num) ? num : null;
}

function parseDurationMinutes(dur: string | null | undefined): number {
  if (!dur) return 0;
  const m = dur.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function formatWellnessPrice(duration: string | null, price: number): string {
  const minutes = parseDurationMinutes(duration);
  const formatted = price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `From THB ${formatted} for ${minutes} min`;
}

// ---------------------------------------------------------------------------
// Pricing calculations
// ---------------------------------------------------------------------------

export function calculateFinalPrice(
  basePrice: number | null,
  discountType: "percent" | "fixed" | null,
  discount: number,
  serviceChargeType: "percent" | "fixed" | null,
  serviceCharge: number
): { afterDiscount: number; chargeAmount: number; finalPrice: number } | null {
  if (basePrice === null || basePrice <= 0) return null;

  let discountAmount: number;
  if (discountType === "percent") {
    discountAmount = basePrice * discount / 100;
  } else {
    discountAmount = discount;
  }

  const afterDiscount = basePrice - discountAmount;

  let chargeAmount: number;
  if (serviceChargeType === "percent") {
    chargeAmount = afterDiscount * serviceCharge / 100;
  } else {
    chargeAmount = serviceCharge;
  }

  const finalPrice = afterDiscount + chargeAmount;
  return { afterDiscount, chargeAmount, finalPrice };
}

export function formatPriceDisplay(price: number | null, currency: "THB" | "NPR" | "INR"): string {
  if (price === null) return "-";
  return `${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function calculateWellnessPrices(
  basePrice: number | null,
  discountType: "percent" | "fixed" | null,
  discount: number,
  serviceChargeType: "percent" | "fixed" | null,
  serviceCharge: number
): WellnessPriceOption[] {
  if (basePrice === null) return [];

  const results: WellnessPriceOption[] = [];

  if (discountType === "percent") {
    const discountAmount = basePrice * discount / 100;
    const afterDiscount = basePrice - discountAmount;
    const chargeAmount = serviceChargeType === "percent" ? afterDiscount * serviceCharge / 100 : serviceCharge;
    const finalPrice = afterDiscount + chargeAmount;
    results.push({ durationMin: 60, price: finalPrice, display: `From THB ${finalPrice.toFixed(2)} for 60 min` });
  } else {
    const afterDiscount = basePrice - discount;
    const chargeAmount = serviceChargeType === "percent" ? afterDiscount * serviceCharge / 100 : serviceCharge;
    const finalPrice = afterDiscount + chargeAmount;
    results.push({ durationMin: 60, price: finalPrice, display: `From THB ${finalPrice.toFixed(2)} for 60 min` });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export function computeRelevanceScore(service: Service, searchTerm: string): number {
  if (!searchTerm) return 0;
  const term = searchTerm.toLowerCase();
  let score = 0;

  const titleLower = service.title.toLowerCase();
  if (titleLower === term) score += 100;
  else if (titleLower.startsWith(term)) score += 80;
  else if (titleLower.includes(term)) score += 50;

  if (service.category) {
    const catNameLower = service.category.title.toLowerCase();
    if (catNameLower === term) score += 30;
    else if (catNameLower.startsWith(term)) score += 20;
    else if (catNameLower.includes(term)) score += 10;
  }

  // Deterministic tie-breaker using service id
  const idHash = Number(service.id.slice(0, 8).substring(0, 4));
  score += idHash / 10000;

  return score;
}

export function compareServices(
  a: Service,
  b: Service,
  sortBy: "relevance" | "priceLow" | "priceHigh" | "rating",
  searchTerm: string
): number {
  let comparison = 0;

  switch (sortBy) {
    case "relevance": {
      const scoreA = computeRelevanceScore(a, searchTerm);
      const scoreB = computeRelevanceScore(b, searchTerm);
      comparison = scoreB - scoreA;
      break;
    }
    case "priceLow": {
      const priceA = a.prices.basePrice !== null ? a.prices.basePrice : Infinity;
      const priceB = b.prices.basePrice !== null ? b.prices.basePrice : Infinity;
      comparison = priceA - priceB;
      break;
    }
    case "priceHigh": {
      const priceA = a.prices.basePrice !== null ? a.prices.basePrice : -Infinity;
      const priceB = b.prices.basePrice !== null ? b.prices.basePrice : -Infinity;
      comparison = priceB - priceA;
      break;
    }
    case "rating": {
      // Rating comparison disabled for framework independence;
      // all services receive same rating score.
      comparison = 0;
      break;
    }
  }

  if (comparison === 0) {
    comparison = a.id.localeCompare(b.id);
  }

  return comparison;
}

export function getServicePriceForSorting(svc: Service): number | null {
  if (svc.prices.basePrice !== null) return svc.prices.basePrice;
  if (svc.prices.wellnessPricing && svc.prices.wellnessPricing.length > 0) {
    return svc.prices.wellnessPricing[0].price;
  }
  return null;
}

// ---------------------------------------------------------------------------
// End of module
// ---------------------------------------------------------------------------