import type {
  Category,
  CurrencyCode,
  FilterState,
  Provider,
  Service,
  SortOption,
} from "@/types/domain";
import { parseMoney } from "../pricing/calculate";

export type ExplorerFilters = Pick<
  FilterState,
  | "serviceTypes"
  | "categories"
  | "subCategories"
  | "providers"
  | "cities"
  | "countries"
  | "priceMin"
  | "priceMax"
  | "priceCurrency"
  | "testAtHome"
  | "searchQuery"
>;

export interface FacetCounts {
  serviceTypes: Map<string, number>;
  categories: Map<string, number>;
  providers: Map<number, number>;
  cities: Map<string, number>;
  countries: Map<string, number>;
}

function providerById(providers: Provider[]): Map<number, Provider> {
  return new Map(providers.map((p) => [p.id, p]));
}

function categoryTitle(
  service: Service,
  categories: Map<string, Category>,
): string {
  return categories.get(service.categoryId)?.title ?? "";
}

function serviceNumericPrice(service: Service): number | null {
  if (service.type === "wellness") {
    const prices = service.wellnessPricing
      .map((o) => parseMoney(o.price))
      .filter((n): n is number => n != null);
    if (prices.length === 0) return null;
    return Math.min(...prices);
  }
  return parseMoney(service.price);
}

function matchesSearch(
  service: Service,
  providers: Map<number, Provider>,
  categories: Map<string, Category>,
  query: string,
): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;

  const providerName =
    providers.get(service.userId)?.providerInformation.companyName ?? "";
  const haystack = [
    service.title,
    providerName,
    categoryTitle(service, categories),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(term);
}

function matchesFilters(
  service: Service,
  providers: Map<number, Provider>,
  categories: Map<string, Category>,
  filters: ExplorerFilters,
  except?: keyof ExplorerFilters,
): boolean {
  if (except !== "serviceTypes" && filters.serviceTypes.size > 0) {
    if (!filters.serviceTypes.has(service.type)) return false;
  }

  if (except !== "categories" && filters.categories.size > 0) {
    if (!filters.categories.has(service.categoryId)) return false;
  }

  if (except !== "subCategories" && filters.subCategories.size > 0) {
    if (
      !service.subCategoryId ||
      !filters.subCategories.has(service.subCategoryId)
    ) {
      return false;
    }
  }

  if (except !== "providers" && filters.providers.size > 0) {
    if (!filters.providers.has(service.userId)) return false;
  }

  const provider = providers.get(service.userId);
  const citySlug = provider?.providerInformation.city.slug;
  const countryCode = provider?.providerInformation.country.alphaCode;

  if (except !== "cities" && filters.cities.size > 0) {
    if (!citySlug || !filters.cities.has(citySlug)) return false;
  }

  if (except !== "countries" && filters.countries.size > 0) {
    if (!countryCode || !filters.countries.has(countryCode)) return false;
  }

  if (except !== "testAtHome" && filters.testAtHome != null) {
    if (service.testAtHome !== filters.testAtHome) return false;
  }

  if (except !== "searchQuery") {
    if (!matchesSearch(service, providers, categories, filters.searchQuery)) {
      return false;
    }
  }

  const priceFilterActive =
    except !== "priceMin" &&
    except !== "priceMax" &&
    except !== "priceCurrency" &&
    (filters.priceMin != null ||
      filters.priceMax != null ||
      filters.priceCurrency != null);

  if (priceFilterActive) {
    const currency = provider?.providerInformation.currency as
      | CurrencyCode
      | undefined;
    if (filters.priceCurrency && currency !== filters.priceCurrency) {
      return false;
    }
    if (filters.priceMin != null || filters.priceMax != null) {
      const price = serviceNumericPrice(service);
      if (price == null) return false;
      if (filters.priceMin != null && price < filters.priceMin) return false;
      if (filters.priceMax != null && price > filters.priceMax) return false;
    }
  }

  return true;
}

export function applyAllFilters(
  services: Service[],
  providers: Provider[],
  categories: Map<string, Category>,
  filters: ExplorerFilters,
): Service[] {
  const providerMap = providerById(providers);
  return services.filter((service) =>
    matchesFilters(service, providerMap, categories, filters),
  );
}

export function sortServices(
  services: Service[],
  providers: Provider[],
  sortOption: SortOption,
  searchQuery: string,
): Service[] {
  const providerMap = providerById(providers);
  const term = searchQuery.trim().toLowerCase();

  const relevance = (service: Service): number => {
    if (!term) return 0;
    const title = service.title.toLowerCase();
    if (title === term) return 3;
    if (title.startsWith(term)) return 2;
    if (title.includes(term)) return 1;
    const providerName =
      providerMap.get(service.userId)?.providerInformation.companyName ?? "";
    if (providerName.toLowerCase().includes(term)) return 0.5;
    return 0;
  };

  return [...services].sort((a, b) => {
    let comparison = 0;
    switch (sortOption) {
      case "priceLow":
      case "priceHigh": {
        const priceA = serviceNumericPrice(a) ?? Number.POSITIVE_INFINITY;
        const priceB = serviceNumericPrice(b) ?? Number.POSITIVE_INFINITY;
        comparison =
          sortOption === "priceLow" ? priceA - priceB : priceB - priceA;
        break;
      }
      case "rating": {
        const ratingA =
          providerMap.get(a.userId)?.providerInformation.rating ?? 0;
        const ratingB =
          providerMap.get(b.userId)?.providerInformation.rating ?? 0;
        comparison = ratingB - ratingA;
        break;
      }
      case "relevance":
      default:
        comparison = relevance(b) - relevance(a);
        break;
    }
    if (comparison === 0) comparison = a.id.localeCompare(b.id);
    return comparison;
  });
}

export function computeFacets(
  services: Service[],
  providers: Provider[],
  categories: Map<string, Category>,
  filters: ExplorerFilters,
): FacetCounts {
  const providerMap = providerById(providers);
  const counts: FacetCounts = {
    serviceTypes: new Map(),
    categories: new Map(),
    providers: new Map(),
    cities: new Map(),
    countries: new Map(),
  };

  const bump = <K,>(map: Map<K, number>, key: K) => {
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  for (const service of services) {
    if (matchesFilters(service, providerMap, categories, filters, "serviceTypes")) {
      bump(counts.serviceTypes, service.type);
    }
    if (matchesFilters(service, providerMap, categories, filters, "categories")) {
      bump(counts.categories, service.categoryId);
    }
    if (matchesFilters(service, providerMap, categories, filters, "providers")) {
      bump(counts.providers, service.userId);
    }
    const provider = providerMap.get(service.userId);
    if (
      provider &&
      matchesFilters(service, providerMap, categories, filters, "cities")
    ) {
      bump(counts.cities, provider.providerInformation.city.slug);
    }
    if (
      provider &&
      matchesFilters(service, providerMap, categories, filters, "countries")
    ) {
      bump(counts.countries, provider.providerInformation.country.alphaCode);
    }
  }

  return counts;
}
