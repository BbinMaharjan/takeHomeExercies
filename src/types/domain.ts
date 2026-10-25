/**
 * Domain types for the MedEx Service Explorer.
 * These types are derived from the JSON data structure and validated/normalized
 * at the API boundary. They should be framework-independent so they can be used
 * both in the API layer and UI components.
 */

/** Category type from the MedEx dataset */
export type CategoryType = 'package' | 'lab_test' | 'service' | 'wellness' | 'insurance'

export interface SubCategory {
  id: string
  title: string
  slug: string
  type: CategoryType
  position: number
  status: boolean
  parentId: string | null
}

export interface Category {
  id: string
  title: string
  slug: string
  type: CategoryType
  position: number
  status: boolean
  parentId: string | null
  children: SubCategory[]
}

/** Provider type from the MedEx dataset */
export interface ProviderInformation {
  companyName: string
  slug: string
  types: CategoryType[]
  currency: 'THB' | 'NPR' | 'INR'
  city: {
    id: string
    name: string
    slug: string
  }
  country: {
    id: number
    name: string
    alphaCode: string
  }
  rating: number | null
  reviewCount: number
}

export interface Provider {
  id: number
  name: string
  username: string
  status: 'active' | 'inactive'
  providerInformation: ProviderInformation
}

/** Service type from the MedEx dataset */
export type ServiceType = 'package' | 'lab_test' | 'service' | 'wellness'

export interface ServicePricingOption {
  id: string
  durationInMinutes: number
  price: string
  discount: string
  discountType: 'percent' | 'amount'
  serviceCharge: string
  serviceChargeType: 'percent' | 'amount'
}

export interface Service {
  id: string
  title: string
  slug: string
  type: ServiceType
  userId: number
  categoryId: string
  subCategoryId: string | null
  price: string | null
  discount: string | null
  discountType: 'percent' | 'amount' | null
  serviceCharge: string | null
  serviceChargeType: 'percent' | 'amount' | null
  status: boolean
  testAtHome: boolean
  homeTestCharge: string | null
  wellnessPricing: ServicePricingOption[]
  createdAt: string
}

/** Sort modes used by the Service Explorer */
export type SortOption = 'relevance' | 'priceLow' | 'priceHigh' | 'rating'

/** Currency codes present in the dataset */
export type CurrencyCode = 'THB' | 'NPR' | 'INR'

/**
 * Applied explorer filters. Sets are used for multi-select facets.
 * URL search params are the source of truth; parse with `parseFilterState`.
 */
export interface FilterState {
  serviceTypes: Set<string>
  categories: Set<string>
  subCategories: Set<string>
  providers: Set<number>
  cities: Set<string>
  countries: Set<string>
  priceMin: number | null
  priceMax: number | null
  priceCurrency: CurrencyCode | null
  testAtHome: boolean | null
  searchQuery: string
  sortOption: SortOption
  page: number
}

/** Minimal URLSearchParams surface so this module stays framework-independent. */
export interface SearchParamReader {
  get(name: string): string | null
  getAll(name: string): string[]
}

const EMPTY_FILTER_STATE: FilterState = {
  serviceTypes: new Set(),
  categories: new Set(),
  subCategories: new Set(),
  providers: new Set(),
  cities: new Set(),
  countries: new Set(),
  priceMin: null,
  priceMax: null,
  priceCurrency: null,
  testAtHome: null,
  searchQuery: '',
  sortOption: 'relevance',
  page: 1,
}

function splitValues(searchParams: SearchParamReader, ...keys: string[]): string[] {
  const values: string[] = []
  for (const key of keys) {
    const all = searchParams.getAll(key)
    const raw = all.length > 0 ? all : [searchParams.get(key)]
    for (const item of raw) {
      if (!item) continue
      for (const part of item.split(',')) {
        const trimmed = part.trim()
        if (trimmed) values.push(trimmed)
      }
    }
  }
  return values
}

function parseOptionalNumber(value: string | null): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function parseSortOption(value: string | null): SortOption {
  if (value === 'relevance' || value === 'priceLow' || value === 'priceHigh' || value === 'rating') {
    return value
  }
  return 'relevance'
}

function parseCurrency(value: string | null): CurrencyCode | null {
  if (value === 'THB' || value === 'NPR' || value === 'INR') return value
  return null
}

function parseOptionalBoolean(value: string | null): boolean | null {
  if (value == null || value === '') return null
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return null
}

/**
 * Parse explorer filter state from URL search params.
 * Accepts both this app's query names (`q`, `type`, `providerId`) and
 * aliases used by the explorer page (`search`, `service_type`, `provider`).
 */
export function parseFilterState(searchParams: SearchParamReader): FilterState {
  const page = parseOptionalNumber(searchParams.get('page'))
  return {
    ...EMPTY_FILTER_STATE,
    serviceTypes: new Set(splitValues(searchParams, 'service_type', 'type')),
    categories: new Set(splitValues(searchParams, 'category', 'categoryId')),
    subCategories: new Set(splitValues(searchParams, 'subcategory', 'subCategory')),
    providers: new Set(
      splitValues(searchParams, 'provider', 'providerId')
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id)),
    ),
    cities: new Set(splitValues(searchParams, 'city')),
    countries: new Set(splitValues(searchParams, 'country')),
    priceMin: parseOptionalNumber(searchParams.get('priceMin')),
    priceMax: parseOptionalNumber(searchParams.get('priceMax')),
    priceCurrency: parseCurrency(searchParams.get('currency')),
    testAtHome: parseOptionalBoolean(
      searchParams.get('testAtHome') ?? searchParams.get('availableAsHomeTest'),
    ),
    searchQuery: (searchParams.get('q') ?? searchParams.get('search') ?? '').trim(),
    sortOption: parseSortOption(searchParams.get('sortBy') ?? searchParams.get('sort')),
    page: page != null && page >= 1 ? Math.floor(page) : 1,
  }
}