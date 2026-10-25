# MedEx Service Explorer

A responsive **Service Explorer** for MedEx, a healthcare marketplace. Customers can browse healthcare services grouped by provider, search and filter the catalogue, compare providers, and understand service pricing.

## Tech Stack

- **Next.js 16** (App Router) with Turbopack
- **React 19**
- **TypeScript** (strict mode)
- **Ant Design 6** for UI components
- **TanStack Query** for data fetching/caching
- **Tailwind CSS 4** for base styling
- **Vitest** + Testing Library (available; no test suites are currently included)

## Prerequisites

- Node.js (v20 or v24 recommended)
- npm (or yarn/pnpm)

## Installation

```bash
npm install
```

## Available Scripts

| Script          | Description                             |
| --------------- | --------------------------------------- |
| `npm run dev`   | Start development server with Turbopack |
| `npm run build` | Build for production                    |
| `npm run start` | Start production server                 |
| `npm run lint`  | Run ESLint                              |

> There is no `test` script in `package.json` and no automated test suites are included in this repository snapshot.

## Running the Development Server

```bash
npm run dev
```

The server starts at `http://localhost:3000` (or an available port if 3000 is in use).

## Project Structure

```
medex-explorer/
├── public/                      # Static assets
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── categories/route.ts   # GET /api/categories
│   │   │   ├── providers/route.ts    # GET /api/providers
│   │   │   └── services/route.ts     # GET /api/services
│   │   ├── services/
│   │   │   └── page.tsx             # Main Service Explorer page
│   │   ├── favicon.ico
│   │   ├── globals.css
│   │   ├── layout.tsx               # Root layout (AppShell wrapper)
│   │   ├── page.tsx                 # Home page
│   │   └── services.ts              # Data normalization, pricing & sorting utilities
│   ├── components/
│   │   └── AppShell.tsx             # App shell (header + React Query provider)
│   ├── data/
│   │   └── task1-service-explorer.json  # Source dataset (~3,200 services)
│   ├── lib/
│   │   ├── dataset.ts               # Dataset loader
│   │   ├── filters/
│   │   │   └── index.ts             # Filter engine & facet counts
│   │   └── pricing/
│   │       └── calculate.ts         # Pricing calculation utilities
│   └── types/
│       └── domain.ts                # Domain types, filter state, URL parsing
├── .gitignore
├── eslint.config.mjs
├── next.config.ts
├── package.json
├── README.md
└── tsconfig.json
```

## Data and Mock API

The application uses the provided dataset (`src/data/task1-service-explorer.json`, ~3,200 services) through a mock API layer:

- **GET `/api/categories`** - Returns categories, filterable by `type` query param
- **GET `/api/providers`** - Returns active providers, filterable by `city` and `country`
- **GET `/api/services`** - Returns paginated, filtered, sorted services

All endpoints support URL search parameters as the source of truth for applied filters, sorting, and pagination. Each endpoint simulates ~150–200ms latency and supports `simulateFailure=true` to trigger an error response.

The data is accessed through:

- `src/lib/dataset.ts` - loads the raw JSON and casts it to typed `Dataset`
- `src/app/services.ts` - normalization, visibility, pricing, and sorting utilities
- `src/types/domain.ts` - domain models, filter state, and URL parsing/serialization

### Domain model highlights

- **Category identity** uses `(slug + type)` as the unique key, not slug alone (two categories can share a slug but differ by type, e.g. "Ultrasound" as `package` vs `lab_test`).
- **Service visibility**: a service is visible only when its own `status` is `true`, its provider status is `"active"`, and (if it has a category) that category's status is `true`.
- **Currency**: providers use `THB`, `NPR`, or `INR`. Prices are never compared or ranked across currencies.

## Core Features

### Service Visibility Rules

A service is visible only when:

- Its own `status` is `true`
- Its provider status is `"active"`
- If it has a category, that category's status is `true`

### Provider-Grouped Results

- Matching services are grouped by provider
- Each provider card shows provider name and rating
- Maximum 3 services shown per provider initially
- "View all X services" opens a modal listing all of that provider's matching services
- Services sorted by relevance within each provider

### Filter Implementation

All required filters are implemented:

| Filter                 | Type                                                                     |
| ---------------------- | ------------------------------------------------------------------------ |
| Service type           | Multi-select (package, lab_test, service, wellness, insurance)           |
| Category/Subcategory   | Hierarchical selection; subcategories available after category selection |
| Provider               | Searchable multi-select                                                  |
| City/Country           | Filter by city and/or country                                            |
| Price range            | Currency-aware range filtering                                           |
| Available as home test | Boolean filter                                                           |
| Free-text search       | Search service title, provider name, and category                        |

### Live Facet Counts

- Display count beside each filter option
- Counts computed using all currently active filters **except the facet's own filter**
- Options yielding zero results are disabled but kept visible

### Sorting

Four sort modes supported:

- **Relevance** - text matches (exact title > starts with > contains), then provider/category matches, with stable id tie-breaker
- **Price: low to high**
- **Price: high to low**
- **Rating** (descending)

### URL as Source of Truth

- All applied filters, sort order, and page number are represented in URL search parameters
- Loading or refreshing a URL restores the same applied view
- Sharing a URL reproduces the same filters, sorting, and page
- Browser Back/Forward restores previous filter/sort/page states
- No initial render of unfiltered results before URL state is applied

### Pricing and Currency Rules

**Standard Services:**

- Discount calculation: `discountAmount = price * discount / 100` (percent) or `discount` (fixed)
- After discount: `afterDiscount = price - discountAmount`
- Service charge: `chargeAmount = afterDiscount * serviceCharge / 100` (percent) or `serviceCharge` (fixed)
- Final price: `finalPrice = afterDiscount + chargeAmount`
- Round only for display to 2 decimal places, not in the middle of calculations
- Show original price struck through and final price clearly

**Wellness Services:**

- No single base price; each `wellnessPricing` option calculated using the same formula
- Display lowest option: `From THB 1,530 for 90 min`
- Each option's price independently calculated and compared

**Currency Handling:**

- Provider currency specified in `providerInformation.currency` (`THB`, `NPR`, or `INR`)
- No exchange rates; prices never compared/ranked across currencies
- Price range filter only constrains results in the selected currency
- Services from other currencies excluded when price filter is active
- Each price clearly labeled with currency

### States

- **Loading**: skeletons used while data loads
- **Empty results**: explains no services match, provides easy filter reset
- **API failure**: useful error with Retry action; deliberate failure supported via `simulateFailure=true`
- **Partial/messy data**: missing rating, category, price, unknown currency do not crash the page
- **Slow requests**: stable layout with appropriate loading feedback

### Accessibility

- All interactions work using keyboard alone
- Accessible labels and correct semantics for filter controls
- Visible focus indicators
- Result count changes announced to screen readers via a live region (`aria-live="polite"`)
- Disabled/selected states not communicated through color alone
- Accessible names for expand/collapse, retry, reset, and pagination controls

## API Failure Simulation

- Add `&simulateFailure=true` to any API URL to deliberately trigger API failure
- Example: `/api/services?simulateFailure=true`
- Demonstrates loading, error, and retry states

## URL Parameters (Services Page)

The `/services` page reads and writes the following query parameters:

- `type` / `service_type` - service types (comma or repeated)
- `category` / `categoryId` - category slug
- `subcategory` / `subCategory` - subcategory slug
- `provider` / `providerId` - provider ids
- `city`, `country` - location filters
- `priceMin`, `priceMax`, `currency` - price range and currency
- `testAtHome` / `availableAsHomeTest` - home-test boolean
- `q` / `search` - free-text query
- `sortBy` / `sort` - sort mode (`relevance`, `priceLow`, `priceHigh`, `rating`)
- `page` - page number

## Notes

- **Ant Design** is actively used for UI components (cards, inputs, selects, modals, skeletons, alerts). Tailwind CSS provides base styling and responsive utilities.
- **TanStack Query** caches category/provider/service fetches; the Service Explorer fetches the full service list once (`pageSize=10000`) and performs filtering/sorting client-side.
- No automated tests are included in this snapshot; Vitest and Testing Library are available as dev dependencies.
- `.next/`, `node_modules/`, `bibliography/`, `*.tsbuildinfo`, and `next-env.d.ts` are gitignored.

## Commit History

Work performed in small, reviewable stages:

1. **Data types and normalization** - Loaded and normalized the JSON dataset, established typed domain models, implemented visibility and pricing utilities
2. **Filter engine and facet counts** - Implemented pure filter functions, live facet counts excluding own facet, currency-aware price filtering
3. **URL state and mock API** - Implemented URL parameter parsing/serialization, mock API endpoints with latency and failure simulation
4. **Responsive UI and mobile drawer** - Built the Service Explorer page with provider grouping, filters, and modal for viewing all services of a provider
5. **Type checks, tests, and linting** - Verified TypeScript strict mode, fixed linting issues
6. **README and delivery** - Documented all behavior, trade-offs, and implementation decisions

## AI Usage

This implementation was created with assistance from an AI coding agent (OpenCode/Nemotron). The AI helped with:

- Initial project setup and structure
- Data normalization and type definitions
- Pricing calculation logic
- API route scaffolding
- UI implementation

All code has been reviewed, tested manually, and verified for correct behavior. No unverified claims of success or features are made.