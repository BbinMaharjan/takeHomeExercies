# MedEx Explorer

Live demo: https://take-home-exercies.vercel.app/

MedEx Explorer is a Next.js healthcare marketplace prototype that combines three take-home tasks:

1. **Task 1 – Service Explorer**: browse ~3,200 healthcare services grouped by provider, filter/search/sort/paginate, with live facet counts and currency-aware pricing helpers.
2. **Task 2 – Multi-provider cart and split checkout**: group cart lines by type, keep currency subtotals separate, merge a guest cart, and check out each group independently with idempotency and partial-failure recovery.
3. **Task 3 – Appointment booking across time zones**: normalize messy provider time-zone strings, generate provider-local slots, support group bookings, show provider and customer clocks, and reschedule an existing booking.

This is a frontend take-home prototype. Mock APIs use in-memory state and are **not** a durable or secure backend.

## Prerequisites

- Node.js 20+
- npm

## Run

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

Other useful commands:

```bash
npm run build        # production build
npm run lint         # ESLint
npm run test         # Vitest
npx tsc --noEmit     # strict TypeScript check
```

Verified on this repository:

- `npm run test`: **42 tests passed** across 5 test files.
- `npx tsc --noEmit`: passed.
- `npm run lint`: 0 errors, 37 warnings.
- `npm run build`: passed.

## Main architecture and data flow

```text
src/data/*.json                 # provided fixtures (source of truth)
  -> src/lib/dataset.ts         # typed dataset access
  -> src/app/api/**/route.ts    # Next.js Route Handlers (mock API)
  -> fetch / TanStack Query     # client request lifecycle/cache
  -> src/app/*/page.tsx         # UI
  -> src/lib/*                  # pure domain logic (filters, cart, pricing, time zones, slots)
```

Key rules:

- UI components do not import the JSON fixtures directly.
- Fixtures are read by server-side code or mock store modules.
- Domain types live in `src/types`.
- High-risk logic is kept in framework-independent modules under `src/lib` so it can be unit-tested directly.
- No Redux Toolkit, Zustand, or other global state library is used. State is URL params, React local state, and a small `sessionStorage` adapter for checkout recovery.

## Stack

- Next.js App Router
- React 19 + TypeScript (strict)
- Ant Design for interactive components
- Tailwind CSS for layout and responsive styling
- TanStack Query for request state, caching, invalidation, and retry behavior
- Vitest + React Testing Library for tests
- Native `Intl` for time-zone handling

## Task 1 – Service Explorer

Implemented:

- Provider-grouped results with provider name and rating.
- At most three matching services per provider initially, with an action to view all matching services for a provider.
- All required filters: service type, hierarchical category/subcategory, searchable provider multi-select, city/country, price range, home-test boolean, and free-text search.
- Live facet counts.
- Sorting: relevance, price low/high, rating.
- URL search params as the source of truth for filters, sort, and page.
- Mobile filter drawer with pending values and pending result count.
- Loading skeletons, empty state, API error/retry, and messy-data handling.

### URL parameter format

The explorer serializes `FilterState` as query parameters. Both canonical and alias names are accepted by `parseFilterState`:

| Meaning      | Parameters                          |
| ------------ | ----------------------------------- |
| Service type | `type`, `service_type`              |
| Category     | `category`, `categoryId`            |
| Subcategory  | `subcategory`, `subCategory`        |
| Provider     | `provider`, `providerId`            |
| City         | `city`                              |
| Country      | `country`                           |
| Price range  | `priceMin`, `priceMax`, `currency`  |
| Home test    | `testAtHome`, `availableAsHomeTest` |
| Search       | `q`, `search`                       |
| Sort         | `sort`, `sortBy`, `sortDir`         |
| Page         | `page`, `pageSize`                  |

`currency` is the price-filter currency (`THB`, `NPR`, or `INR`). Applied filters, sort, and page are restored on reload and browser back/forward.

### Facet-count algorithm

`computeFacets` in `src/lib/filters/index.ts` iterates the full filtered dataset once per facet. For each facet option, it calls `matchesFilters` with an `except` parameter so that facet's own selection is ignored while all other active filters still apply.

This means:

- Selecting "THB" in the currency facet does not remove other currencies from the currency facet counts.
- Counts stay correct when multiple filters are selected.
- Zero-result options remain visible but disabled so users can see the available choice space.

### Pricing rules

`src/lib/pricing/calculate.ts` implements the required formula:

```text
discountAmount = discountType === "percent" ? price * discount / 100 : discount
afterDiscount = price - discountAmount
chargeAmount = serviceChargeType === "percent" ? afterDiscount * serviceCharge / 100 : serviceCharge
finalPrice = afterDiscount + chargeAmount
```

Rules implemented in helpers:

- Money strings are parsed with `Number` and invalid/missing/non-finite values become `null`, never `0`.
- Calculations preserve precision; rounding is only for display (`toFixed(2)`).
- Amount and percent discount/charge types are handled explicitly.
- Wellness services calculate each `wellnessPricing` option with the same formula and expose a lowest option.
- Missing prices are shown as unavailable, not zero.

Currency rules:

- Provider currency comes from `providerInformation.currency` (`THB`, `NPR`, or `INR`).
- There are no exchange rates.
- Prices in different currencies are never added, compared, ranked, or filtered together.
- A price range applies only to the selected currency; services in other currencies are excluded while a price filter is active.
- Mixed currencies may appear together when no price filter is active, but each price is labelled with its currency.

Known pricing limitation: `formatPrice` and `getLowestWellnessOption` currently hard-code `THB` in their display strings. The numeric calculation is currency-agnostic, but the explorer UI mostly displays the raw `price` string and does not yet render calculated final prices. This is a documented gap, not a verified feature.

### Relevance sort

Relevance is a deterministic text score, not a medical judgment:

- Exact title match: 3
- Title starts with query: 2
- Title contains query: 1
- Provider name contains query: 0.5
- Otherwise: 0

Ties are broken by service id (`localeCompare`).

### Data inconsistencies found and handling

Task 1 fixture (`src/data/task1-service-explorer.json`):

- ~3,200 services; 198 have `status: false`.
- 2 providers are inactive.
- 1 category (`Seasonal Offers`) is inactive.
- 5 providers have `rating: null`.
- 22 services have no category.
- 650 wellness services have no single base `price` (they use `wellnessPricing`).
- Service type includes `insurance`, while the `ServiceType` union in `src/types/domain.ts` does not list it; it is handled as a string in the filter engine.
- Category identity is not slug-only: `ultrasound` and `thyroid` appear under multiple types, and `thyroid` even appears twice under `lab_test`. Categories and subcategories are therefore keyed by id and filtered by slug plus type.
- Currency is provider-level (`THB`, `NPR`, `INR`), not service-level.

Visibility rule: a service is shown only when its own `status` is true, its provider status is `active`, and, if it has a category, that category's status is true.

## Task 2 – Cart, merge, and split checkout

Implemented in `src/app/cart`, `src/app/checkout`, `src/lib/cart`, and `src/lib/checkout`.

### Cart grouping and currency behavior

- Lines are grouped by the API-provided group `type`.
- Each group shows its own subtotal(s).
- A group can contain more than one currency; subtotals are shown per currency.
- There is no mixed-currency grand total.
- `itemCount` is the sum of line quantities, not the number of line items.
- Unavailable products and unpriced wellness lines are tracked via `unpricedItems` and excluded from numeric subtotals.
- A group is checkout-eligible only when every line is available and priced with a positive quantity.

### Quantity changes

- Quantity changes are optimistic.
- Rapid repeated changes are reconciled through the API response.
- Rollback occurs when the server rejects a change.
- Quantity must be an integer from 1 to 99; values above 10 simulate a stock conflict (`409`).

### Wellness items

- A wellness item with no selected duration has an unknown price (`null`).
- It is not shown as `0`, is not included in numeric subtotals, and blocks checkout of its group.
- After selecting a duration, `amount_after_service_charge` becomes the final unit price.
- The selection is persisted through `PATCH /cart/items/:lineId`.

### Unavailable items

- A line with an empty `product` is marked unavailable.
- It cannot be checked out.
- It can be removed.
- Missing product details do not crash the UI.

### Guest cart merge policy

`mergeGuestCart` in `src/lib/cart/merge.ts` applies these rules:

- Invalid product id or quantity is skipped with a reason.
- A guest item whose product no longer exists in the catalog is skipped with `product no longer available`.
- An invalid wellness option is skipped.
- If a matching server line has the same product and same wellness option, quantities are combined.
- Otherwise the guest item is added as a new line.
- The endpoint returns a `changes` array (`added`, `combined`, `skipped`, `updated_option`) so the UI can explain the result.

Trade-off: matching is by product id plus wellness option, not by line id. This is simple and customer-safe, but it can combine quantities even if the server line had a different quantity than expected.

### Split checkout and payment methods

- Each group is checked out independently.
- Supported payment methods: `card` and `pay_at_clinic`.
- A group with unresolved wellness pricing or unavailable items is blocked.
- `POST /checkout` receives `groupType`, eligible `items`, `paymentMethod`, and `idempotencyKey`.
- Multiple groups produce separate orders.
- Partial failure preserves successful orders and retries only failed groups.
- `runAllGroups` processes groups sequentially, not with an all-or-nothing `Promise.all`.

### Idempotency

- Each logical group attempt gets a stable idempotency key.
- The mock server stores `key -> { payloadHash, result }`.
- Repeating the same key and equivalent payload returns the same order.
- Reusing a key with a conflicting payload returns `409`.
- Keys are reused for retries of the same logical attempt.
- A `500` or network failure is treated as an uncertain outcome, not as proof of failure.

### Reload recovery

- Checkout attempt metadata is persisted in `sessionStorage` under `medex.checkout.attempts.v1`.
- Known order ids are reconciled with `GET /orders/:orderId`.
- The page does not restart all groups from scratch after reload.
- `sessionStorage` is client-side convenience state only. It is not a secure or durable payment ledger; production order state must be authoritative on the backend.

### Checkout state machine

States:

`ready`, `blocked`, `submitting`, `pending`, `paid`, `failed`, `needs_attention`

Implemented transitions:

```text
ready -> submitting | blocked
blocked -> ready
submitting -> paid | pending | failed | needs_attention
pending -> paid | failed | needs_attention
needs_attention -> pending | paid | failed | submitting
failed -> submitting
paid -> (terminal)
```

A `201` is not treated as paid unless the returned status is `paid`.

## Task 3 – Booking across time zones

Implemented in `src/app/booking`, `src/lib/timezone`, and `src/lib/booking/slots`.

### Time-zone normalization

`normalizeTimeZone(source, countryCode)` never falls back to the browser's local zone. It handles:

- Valid IANA identifiers, including surrounding whitespace.
- Windows-style names via an explicit map:
  - `Nepal Standard Time` -> `Asia/Kathmandu`
  - `India Standard Time` -> `Asia/Kolkata`
  - `SE Asia Standard Time` -> `Asia/Bangkok`
- UTC offsets such as `UTC+05:45` and `(GMT+5:45)`.
- Legacy alias `Asia/Katmandu` -> `Asia/Kathmandu`.
- Empty or unrecognized values via country fallback:
  - `TH` -> `Asia/Bangkok`
  - `NP` -> `Asia/Kathmandu`
  - `IN` -> `Asia/Kolkata`

Distinct fixture values:

| Source value          | Country | Normalized       |
| --------------------- | ------- | ---------------- |
| `Asia/Bangkok`        | TH      | `Asia/Bangkok`   |
| ` UTC+05:45`          | NP      | `Asia/Kathmandu` |
| `Nepal Standard Time` | NP      | `Asia/Kathmandu` |
| `(GMT+5:45)`          | NP      | `Asia/Kathmandu` |
| `Asia/Katmandu `      | NP      | `Asia/Kathmandu` |
| ``                    | IN      | `Asia/Kolkata`   |

The original source string is retained in `timezoneSource`, and `timeZoneFallbackReason` records fallback decisions.

### Day offsets and provider-local dates

- `dayOffset` is relative to the provider's local today.
- The mock API converts day offsets to concrete provider-local dates when it starts.
- `getProviderToday(zone)` uses `Intl` with the provider zone, not the browser clock.
- Bookings are limited to the next 90 days.

### Slot generation

Slots are generated from specialist consultation windows:

- Start at `consultation.startTime`.
- Each step adds `durationInMinutes + bufferInMinutes`.
- A slot must start and end within both specialist consultation hours and provider opening hours.
- Missing weekday schedule means closed.
- Provider closures remove the whole date.
- Booked slots are visible but disabled.
- On the provider's today, slots that have already started are removed.
- Interval-boundary logic allows a slot ending exactly at closing time, but not one ending after it.
- Partial overlap between specialist and provider hours produces only the overlap.

### Group bookings

- Groups of 1 to 4 people are supported.
- A group of N requires N consecutive free slots in the generated sequence.
- A booked slot breaks any sequence containing it.
- A start is offered only when all required consecutive slots are free and fit inside both schedules.

### Two-clock display

Each slot/booking shows both:

- Provider local time, e.g. `Hospital time (Bangkok)`.
- Customer local time, e.g. `Your time (Kathmandu)`.

Date changes are labelled when conversion crosses midnight. Conversion uses `Intl`/offset logic, not manual fixed-offset arithmetic on `Date`.

### Booking and rescheduling

- `POST /api/bookings` creates a booking and returns `bookingId` or `409`.
- `PUT /api/bookings/:id` reschedules and returns `200` or `409`.
- On `409`, selections are preserved and availability is refreshed.
- Rescheduling shows current vs. new appointment in both time zones before confirmation.
- Confirmation is prevented while an outcome is uncertain.

## Mock API and failure injection

Implemented endpoints:

Task 1:

- `GET /api/categories`
- `GET /api/providers`
- `GET /api/services`

Task 2:

- `GET /api/cart`
- `PATCH /api/cart/items/:lineId`
- `DELETE /api/cart/items/:lineId`
- `POST /api/cart/merge`
- `POST /api/checkout`
- `GET /api/orders/:orderId`

Task 3:

- `GET /api/booking/providers`
- `GET /api/providers/:id`
- `GET /api/providers/:id/slots?date=...&specialistId=...`
- `POST /api/bookings`
- `GET /api/bookings/existing`
- `GET /api/bookings/:id`
- `PUT /api/bookings/:id`

Latency:

- Most endpoints delay 150-200 ms by default.
- Booking endpoints accept `?latency=N` for configurable delay.
- Cart endpoints use 150-200 ms random latency.

Failure injection:

- `?simulateFailure=true` returns `500`.
- `?failStatus=409` (or another status) returns that status.
- Booking: `?simulateConflict=true` forces a `409` on create/update.
- Cart checkout: `?checkoutOutcome=failed|pending|paid`, `?paymentDecline=true`.

Development failure controls are query-parameter based and should not be exposed to ordinary production users.

## Tests

Vitest + React Testing Library. Current tests cover:

- Time-zone normalization and conversion (`src/lib/timezone/index.test.ts`, 13 tests).
- Slot generation, boundaries, overlap, and group availability (`src/lib/booking/slots.test.ts`, 15 tests).
- Cart normalization, grouping, wellness, and unavailable lines (`src/lib/cart/index.test.ts`, 5 tests).
- Guest-cart merge cases (`src/lib/cart/merge.test.ts`, 5 tests).
- Checkout state transitions (`src/lib/checkout/state.test.ts`, 4 tests).

Not currently covered, despite being high-risk in the requirements: pricing calculations, filter engine/facets, URL parsing/serialization, mobile pending filters, quantity concurrency, checkout orchestration/idempotency/reload, booking UI interactions, and accessibility assertions. Those are documented gaps.

## Performance

No formal benchmark script or timing instrumentation is included in this repository. The explorer fetches the full dataset once (`pageSize=10000`) and filters it in memory; filter/facet functions are pure and synchronous. A development-only timing helper could be added to measure actual filter/facet durations, but no measured numbers are claimed here.

## Accessibility

Implemented or attempted:

- Keyboard-accessible controls and visible focus via Ant Design/Tailwind defaults.
- Screen-reader live regions for result counts and outcomes in places.
- Mobile drawer with pending values.
- Disabled booked slots and disabled zero-result facet options.

This has not been audited with an automated accessibility tool or manual screen-reader session in this repository.

## Deliberately omitted or incomplete

- Pricing helpers in `src/lib/pricing/calculate.ts` are not wired into the explorer UI or mock API; service cards display raw prices.
- An alternate, unused implementation exists in `src/app/services.ts`.
- No global state library is used, per requirements; cart/checkout state is local plus `sessionStorage`.
- No automated accessibility audit or performance benchmark is included.
- Mock state is in-memory and resets on server restart.
- Some required tests are not implemented.

## Assumptions and trade-offs

- **Mock backend:** API endpoints use mock data and in-memory state to demonstrate application behavior. State is not durable and resets when the server restarts.
- **Currency handling:** Prices in different currencies are kept separate because no exchange-rate data is provided. A price-range filter applies only to the selected currency.
- **Time zones:** Provider time zones take precedence over the browser's local time zone. Country-based fallbacks are used when the source time zone is missing or invalid, and fallback decisions are recorded.
- **Checkout recovery:** Session storage helps recover client-side checkout attempts, but it is not a replacement for durable server-side order and payment records.
- **Failure simulation:** Query parameters are available for development testing of API errors, booking conflicts, and checkout outcomes. These controls should not be exposed to ordinary production users.
- **Known gaps:** Incomplete pricing integration, missing high-risk test coverage, and the absence of formal performance and accessibility audits are documented in the relevant sections above.

## AI-assisted development

OpenCode was used as an AI-assisted development tool for code scaffolding, implementation support, and refactoring. AI-generated output was reviewed and adjusted as part of the development process.

Validation included TypeScript checks, ESLint, automated tests, and a production build. AI assistance was used as a development aid; the architecture, business rules, trade-offs, and limitations are documented so the implementation can be explained and extended during a technical review.

## Validation status

The following results were recorded for this repository:

- Production build (`npm run build`): passed.
- TypeScript check (`npx tsc --noEmit`): passed.
- Automated tests (`npm run test`): 42 passed across 5 test files.
- ESLint (`npm run lint`): 0 errors and 37 warnings. The warnings remain and should be reviewed; zero errors does not mean the lint run was warning-free.

These results describe the recorded validation run. Rerun the commands before submission if the code has changed. This remains a take-home prototype and has not been production-hardened.
