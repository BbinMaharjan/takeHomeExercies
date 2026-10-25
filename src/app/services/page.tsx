"use client";

import { applyAllFilters, computeFacets, sortServices } from "@/lib/filters";
import {
  Category,
  FilterState,
  Provider,
  Service,
  SortOption,
  parseFilterState,
} from "@/types/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Rate,
  Select,
  Skeleton,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const { Text, Title } = Typography;

function serializeFilterState(state: FilterState): string {
  const params = new URLSearchParams();
  state.serviceTypes.forEach((v) => params.append("type", v));
  state.categories.forEach((v) => params.append("category", v));
  state.subCategories.forEach((v) => params.append("subcategory", v));
  state.providers.forEach((v) => params.append("provider", String(v)));
  state.cities.forEach((v) => params.append("city", v));
  state.countries.forEach((v) => params.append("country", v));
  if (state.priceMin != null) params.set("priceMin", String(state.priceMin));
  if (state.priceMax != null) params.set("priceMax", String(state.priceMax));
  if (state.priceCurrency) params.set("currency", state.priceCurrency);
  if (state.testAtHome != null)
    params.set("testAtHome", String(state.testAtHome));
  if (state.searchQuery) params.set("search", state.searchQuery);
  params.set("sort", state.sortOption);
  params.set("page", String(state.page));
  return params.toString();
}

export default function ServiceExplorer() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [filterState, setFilterState] = useState<FilterState>(() =>
    parseFilterState(searchParams ?? new URLSearchParams()),
  );

  // Modal state for viewing all services of a provider
  const [modalProvider, setModalProvider] = useState<Provider | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // (modal removed in favor of /services page)

  // Sync URL -> state on back/forward
  const lastUrlRef = useRef<string>("");
  useEffect(() => {
    const current = searchParams?.toString() ?? "";
    if (current === lastUrlRef.current) return;
    lastUrlRef.current = current;
    setFilterState(parseFilterState(searchParams ?? new URLSearchParams()));
  }, [searchParams]);

  // Sync state -> URL
  const lastStateRef = useRef<string>("");
  useEffect(() => {
    const serialized = serializeFilterState(filterState);
    if (serialized === lastUrlRef.current) return;
    lastStateRef.current = serialized;
    lastUrlRef.current = serialized;
    router.replace(`?${serialized}`, { scroll: false });
  }, [filterState, router]);

  // Data fetching via TanStack Query
  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const res = await fetch("/api/categories");
      if (!res.ok) throw new Error("Failed to fetch categories");
      const data = await res.json();
      return (data.categories ?? []) as Category[];
    },
  });

  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: async () => {
      const res = await fetch("/api/providers");
      if (!res.ok) throw new Error("Failed to fetch providers");
      const data = await res.json();
      return (data.providers ?? []) as Provider[];
    },
  });

  const servicesQuery = useQuery({
    queryKey: ["services"],
    queryFn: async () => {
      const res = await fetch("/api/services?pageSize=10000");
      if (!res.ok) throw new Error("Failed to fetch services");
      const data = await res.json();
      return (data.services ?? []) as Service[];
    },
  });

  const loading =
    categoriesQuery.isLoading ||
    providersQuery.isLoading ||
    servicesQuery.isLoading;
  const error =
    categoriesQuery.error || providersQuery.error || servicesQuery.error;

  const categories = categoriesQuery.data ?? [];
  const providers = providersQuery.data ?? [];
  const services = servicesQuery.data ?? [];

  const categoryMap = useMemo(() => {
    const m = new Map<string, Category>();
    for (const c of categories) {
      m.set(c.id, c);
      for (const ch of c.children || []) {
        m.set(ch.id, ch as unknown as Category);
      }
    }
    return m;
  }, [categories]);

  const providerMap = useMemo(
    () => new Map(providers.map((p) => [p.id, p])),
    [providers],
  );

  const explorerFilters = useMemo(
    () => ({
      serviceTypes: filterState.serviceTypes,
      categories: filterState.categories,
      subCategories: filterState.subCategories,
      providers: filterState.providers,
      cities: filterState.cities,
      countries: filterState.countries,
      priceMin: filterState.priceMin,
      priceMax: filterState.priceMax,
      priceCurrency: filterState.priceCurrency,
      testAtHome: filterState.testAtHome,
      searchQuery: filterState.searchQuery,
    }),
    [filterState],
  );

  const visibleServices = useMemo(() => {
    if (
      services.length === 0 ||
      providers.length === 0 ||
      categories.length === 0
    )
      return services;
    const filtered = applyAllFilters(
      services,
      providers,
      categoryMap,
      explorerFilters,
    );
    return sortServices(
      filtered,
      providers,
      filterState.sortOption,
      filterState.searchQuery,
    );
  }, [
    services,
    providers,
    categories.length,
    categoryMap,
    explorerFilters,
    filterState.sortOption,
    filterState.searchQuery,
  ]);

  const facets = useMemo(() => {
    if (
      services.length === 0 ||
      providers.length === 0 ||
      categories.length === 0
    )
      return null;
    return computeFacets(services, providers, categoryMap, explorerFilters);
  }, [services, providers, categories.length, categoryMap, explorerFilters]);

  // pagination
  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(visibleServices.length / pageSize));
  const currentPage = Math.min(filterState.page, totalPages);
  const pagedServices = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return visibleServices.slice(start, start + pageSize);
  }, [visibleServices, currentPage]);

  // provider groups (max 3 per provider initially)
  const providerGroups = useMemo(() => {
    const groups = new Map<
      number,
      { provider: Provider; services: Service[] }
    >();
    visibleServices.forEach((service) => {
      const provId = service.userId;
      if (!groups.has(provId)) {
        const prov = providers.find((p) => p.id === provId);
        if (prov) groups.set(provId, { provider: prov, services: [] });
      }
      const group = groups.get(provId);
      if (group) group.services.push(service);
    });
    const result: Array<{
      provider: Provider;
      services: Service[];
      total: number;
    }> = [];
    const totals = new Map<number, number>();
    visibleServices.forEach((s) =>
      totals.set(s.userId, (totals.get(s.userId) ?? 0) + 1),
    );
    groups.forEach((g, id) =>
      result.push({ ...g, total: totals.get(id) ?? g.services.length }),
    );
    return result;
  }, [visibleServices, providers]);

  const groupsPerPage = 6;
  const totalGroupPages = Math.max(
    1,
    Math.ceil(providerGroups.length / groupsPerPage),
  );
  const currentGroupPage = Math.min(filterState.page, totalGroupPages);
  const pagedGroups = useMemo(() => {
    const start = (currentGroupPage - 1) * groupsPerPage;
    return providerGroups.slice(start, start + groupsPerPage);
  }, [providerGroups, currentGroupPage]);

  const modalServices = useMemo(() => {
    if (!modalProvider) return [];
    return visibleServices.filter((s) => s.userId === modalProvider.id);
  }, [modalProvider, visibleServices]);

  const handleFilterChange = useCallback((partial: Partial<FilterState>) => {
    setFilterState((prev) => ({
      ...prev,
      ...partial,
      serviceTypes: partial.serviceTypes
        ? new Set(partial.serviceTypes)
        : new Set(prev.serviceTypes),
      categories: partial.categories
        ? new Set(partial.categories)
        : new Set(prev.categories),
      subCategories: partial.subCategories
        ? new Set(partial.subCategories)
        : new Set(prev.subCategories),
      providers: partial.providers
        ? new Set(partial.providers)
        : new Set(prev.providers),
      cities: partial.cities ? new Set(partial.cities) : new Set(prev.cities),
      countries: partial.countries
        ? new Set(partial.countries)
        : new Set(prev.countries),
      page: partial.page != null ? partial.page : 1,
    }));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <Skeleton
            active
            title={{ width: "40%" }}
            paragraph={{ rows: 1 }}
            className="mb-6"
          />
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-1">
              <Card>
                <Skeleton active paragraph={{ rows: 8 }} />
              </Card>
            </div>
            <div className="lg:col-span-3 space-y-4">
              {[1, 2, 3].map((i) => (
                <Card key={i}>
                  <Skeleton avatar active paragraph={{ rows: 3 }} />
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <Alert
          type="error"
          title="Error loading data"
          description={(error as Error).message}
          action={
            <Button
              onClick={() => {
                categoriesQuery.refetch();
                providersQuery.refetch();
                servicesQuery.refetch();
              }}
            >
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  // Options for selects
  const serviceTypeOptions = [
    "package",
    "lab_test",
    "service",
    "wellness",
    "insurance",
  ].map((t) => ({
    value: t,
    label: `${t} (${facets?.serviceTypes.get(t) ?? 0})`,
    disabled: (facets?.serviceTypes.get(t) ?? 0) === 0,
  }));

  const categoryOptions = categories.map((c) => ({
    value: c.id,
    label: `${c.title} (${facets?.categories.get(c.id) ?? 0})`,
    disabled: (facets?.categories.get(c.id) ?? 0) === 0,
  }));

  const providerOptions = providers.map((p) => ({
    value: p.id,
    label: `${p.providerInformation.companyName} (${facets?.providers.get(p.id) ?? 0})`,
    disabled: (facets?.providers.get(p.id) ?? 0) === 0,
  }));

  const cityOptions = Array.from(
    new Set(providers.map((p) => p.providerInformation.city.slug)),
  ).map((slug) => {
    const p = providers.find((x) => x.providerInformation.city.slug === slug);
    return {
      value: slug,
      label: `${p?.providerInformation.city.name ?? slug} (${facets?.cities.get(slug) ?? 0})`,
      disabled: (facets?.cities.get(slug) ?? 0) === 0,
    };
  });

  const countryOptions = Array.from(
    new Set(providers.map((p) => p.providerInformation.country.alphaCode)),
  ).map((code) => {
    const p = providers.find(
      (x) => x.providerInformation.country.alphaCode === code,
    );
    return {
      value: code,
      label: `${p?.providerInformation.country.name ?? code} (${facets?.countries.get(code) ?? 0})`,
      disabled: (facets?.countries.get(code) ?? 0) === 0,
    };
  });

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-7xl mx-auto p-4">
        <header className="mb-6">
          <Title level={2} style={{ margin: 0 }}>
            MedEx Service Explorer
          </Title>
          <Text type="secondary">
            Browse healthcare services grouped by provider
          </Text>
        </header>

        {/* Live region for result count */}
        <div aria-live="polite" className="sr-only">
          {visibleServices.length} services found
        </div>

        {/* Desktop filters */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
          <div className="lg:col-span-1 space-y-4">
            <Card
              title={
                <div className="flex items-center justify-between py-1">
                  <span className="font-semibold text-gray-800 tracking-tight">
                    Filters
                  </span>
                  <Button
                    type="link"
                    size="small"
                    danger
                    className="p-0 text-xs font-medium hover:opacity-80"
                    onClick={() => {
                      setFilterState(parseFilterState(new URLSearchParams()));
                      router.replace("?", { scroll: false });
                    }}
                  >
                    Reset all
                  </Button>
                </div>
              }
              size="small"
              className="shadow-sm rounded-xl border border-gray-100 overflow-hidden"
              styles={{ body: { padding: "16px" } }}
            >
              <Space direction="vertical" style={{ width: "100%" }} size={14}>
                {/* Search & Sort Group */}
                <div className="space-y-3">
                  <Input.Search
                    placeholder="Search services..."
                    value={filterState.searchQuery}
                    onChange={(e) =>
                      handleFilterChange({ searchQuery: e.target.value })
                    }
                    allowClear
                    className="rounded-lg"
                  />

                  <Select
                    placeholder="Sort by"
                    style={{ width: "100%" }}
                    value={filterState.sortOption}
                    onChange={(v) =>
                      handleFilterChange({ sortOption: v as SortOption })
                    }
                    options={[
                      { value: "relevance", label: "Relevance" },
                      { value: "priceLow", label: "Price: low to high" },
                      { value: "priceHigh", label: "Price: high to low" },
                      { value: "rating", label: "Rating" },
                    ]}
                  />
                </div>

                <div className="border-t border-gray-100 my-1" />

                {/* Categories & Classification Group */}
                <div className="flex flex-col gap-3">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Categories
                  </div>
                  <Select
                    mode="multiple"
                    placeholder="Service type"
                    style={{ width: "100%" }}
                    maxTagCount="responsive"
                    value={[...filterState.serviceTypes]}
                    onChange={(vals) =>
                      handleFilterChange({ serviceTypes: new Set(vals) })
                    }
                    options={serviceTypeOptions}
                  />
                  <Select
                    mode="multiple"
                    placeholder="Category"
                    style={{ width: "100%" }}
                    maxTagCount="responsive"
                    value={[...filterState.categories]}
                    onChange={(vals) =>
                      handleFilterChange({ categories: new Set(vals) })
                    }
                    options={categoryOptions}
                  />
                  <Select
                    mode="multiple"
                    placeholder="Provider"
                    style={{ width: "100%" }}
                    maxTagCount="responsive"
                    showSearch
                    value={[...filterState.providers]}
                    onChange={(vals) =>
                      handleFilterChange({ providers: new Set(vals) })
                    }
                    options={providerOptions}
                    filterOption={(input, option) =>
                      (option?.label ?? "")
                        .toLowerCase()
                        .includes(input.toLowerCase())
                    }
                  />
                </div>

                <div className="border-t border-gray-100 my-1" />

                {/* Location Group */}
                <div className="flex flex-col gap-3">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Location
                  </div>
                  <Select
                    mode="multiple"
                    placeholder="City"
                    style={{ width: "100%" }}
                    maxTagCount="responsive"
                    value={[...filterState.cities]}
                    onChange={(vals) =>
                      handleFilterChange({ cities: new Set(vals) })
                    }
                    options={cityOptions}
                  />
                  <Select
                    mode="multiple"
                    placeholder="Country"
                    style={{ width: "100%" }}
                    maxTagCount="responsive"
                    value={[...filterState.countries]}
                    onChange={(vals) =>
                      handleFilterChange({ countries: new Set(vals) })
                    }
                    options={countryOptions}
                  />
                </div>

                <div className="border-t border-gray-100 my-1" />

                {/* Pricing Group */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Price Range
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <InputNumber
                      placeholder="Min price"
                      className="w-full"
                      value={filterState.priceMin ?? undefined}
                      onChange={(v) =>
                        handleFilterChange({ priceMin: v ?? null })
                      }
                    />
                    <InputNumber
                      placeholder="Max price"
                      className="w-full"
                      value={filterState.priceMax ?? undefined}
                      onChange={(v) =>
                        handleFilterChange({ priceMax: v ?? null })
                      }
                    />
                  </div>
                  <Select
                    placeholder="Currency"
                    style={{ width: "100%" }}
                    value={filterState.priceCurrency ?? undefined}
                    onChange={(v) =>
                      handleFilterChange({ priceCurrency: v ?? null })
                    }
                    allowClear
                    options={[
                      { value: "THB", label: "THB" },
                      { value: "NPR", label: "NPR" },
                      { value: "INR", label: "INR" },
                    ]}
                  />
                </div>

                <div className="border-t border-gray-100 my-1" />

                {/* Toggles */}
                <div className="flex items-center justify-between py-1">
                  <Text className="text-sm font-medium text-gray-700">
                    Home test available
                  </Text>
                  <Switch
                    checked={filterState.testAtHome === true}
                    onChange={(checked) =>
                      handleFilterChange({ testAtHome: checked ? true : null })
                    }
                  />
                </div>
              </Space>
            </Card>
          </div>

          <div className="lg:col-span-3 space-y-4">
            {pagedGroups.length > 0 ? (
              pagedGroups.map((group, idx) => {
                const info = group.provider.providerInformation;
                return (
                  <Card
                    key={idx}
                    className="mb-4 shadow-sm hover:shadow-md transition-all duration-300 rounded-xl border border-gray-100"
                    styles={{ body: { padding: "20px" } }}
                  >
                    {/* Header: Company Name & Rating */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                      <Text
                        strong
                        className="text-lg text-gray-800 tracking-tight"
                      >
                        {info.companyName}
                      </Text>
                      <div className="flex items-center gap-2">
                        <Text type="secondary" className="text-xs font-medium">
                          ({info.rating ?? 0})
                        </Text>
                        <Rate
                          disabled
                          allowHalf
                          value={info.rating ?? 0}
                          className="text-amber-400 text-sm"
                        />
                        <Text type="secondary" className="text-xs font-medium">
                          ({info.reviewCount ?? 0} Reviews)
                        </Text>
                      </div>
                    </div>

                    {/* Location subtitle */}
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-4 font-medium">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      <span>
                        {info.city.name}, {info.country.name}
                      </span>
                    </div>

                    {/* Services List Preview */}
                    <div className="bg-gray-50/60 rounded-lg p-3 border border-gray-100 mb-3">
                      <Space
                        direction="vertical"
                        style={{ width: "100%" }}
                        size={8}
                      >
                        {group.services.slice(0, 3).map((service, sIdx) => (
                          <div
                            key={sIdx}
                            className="flex items-center justify-between py-1.5 border-b border-gray-200/60 last:border-0 last:pb-0 first:pt-0"
                          >
                            <div>
                              <Text className="text-sm font-medium text-gray-700">
                                {service.title}
                              </Text>
                              <div className="text-[11px] text-gray-400 font-medium uppercase tracking-wider">
                                {service.type}
                              </div>
                            </div>
                            <Text className="font-semibold text-gray-800">
                              {service.price ? `$${service.price}` : "-"}
                            </Text>
                          </div>
                        ))}
                      </Space>
                    </div>

                    {/* Footer / View All Button */}
                    {group.total > 3 && (
                      <div className="flex justify-end">
                        <Button
                          type="primary"
                          ghost
                          size="small"
                          className="rounded-md font-medium text-xs px-3 h-8 hover:shadow-sm"
                          onClick={() => {
                            setModalProvider(group.provider);
                            setModalOpen(true);
                          }}
                        >
                          View all {group.total} services →
                        </Button>
                      </div>
                    )}
                  </Card>
                );
              })
            ) : (
              <Card className="rounded-xl border-dashed border-gray-200 text-center py-10">
                <Text type="secondary" className="text-sm">
                  No services match your criteria. Try adjusting your filters.
                </Text>
              </Card>
            )}

            {totalGroupPages > 1 && (
              <div className="flex justify-center mt-6">
                <Pagination
                  current={currentGroupPage}
                  total={totalGroupPages * 10} // Assuming 10 items per page; or replace with your exact total items count
                  pageSize={10}
                  showTotal={(total, range) =>
                    `${range[0]}-${range[1]} of ${total} providers`
                  }
                  showSizeChanger={false}
                  onChange={(page) => handleFilterChange({ page })}
                />
              </div>
            )}

            <div className="flex items-center justify-end mb-3">
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <Text className="text-sm text-gray-500">Services found</Text>
                <span className="inline-flex min-w-7 items-center justify-center rounded-md bg-blue-100 px-2 py-1 text-sm font-semibold text-blue-700">
                  {visibleServices.length}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Services modal */}
        <Modal
          title={
            <div className="pb-2 border-b border-gray-100">
              <div className="text-xl font-bold text-gray-800 tracking-tight">
                {modalProvider?.providerInformation.companyName ||
                  "Provider Services"}
              </div>
              <div className="flex items-center gap-2 mt-1">
                {modalProvider?.providerInformation.rating && (
                  <div className="flex items-center gap-1 text-xs text-amber-500 font-semibold bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200/60">
                    ★ {modalProvider.providerInformation.rating}
                  </div>
                )}
                <Tag
                  color="blue"
                  className="rounded-full text-xs font-medium px-2.5"
                >
                  {modalServices.length}{" "}
                  {modalServices.length === 1 ? "Service" : "Services"}{" "}
                  Available
                </Tag>
              </div>
            </div>
          }
          open={modalOpen}
          onCancel={() => setModalOpen(false)}
          width={680}
          centered
          footer={false}
          styles={{
            body: {
              maxHeight: "60vh",
              overflowY: "auto",
              paddingRight: "6px",
              paddingTop: "16px",
              paddingBottom: "16px",
            },
          }}
        >
          {modalServices.length > 0 ? (
            <div className="flex flex-col gap-3">
              {modalServices.map((service: Service, idx: number) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3.5 bg-gray-50/70 hover:bg-gray-100/80 transition-all duration-200 rounded-xl border border-gray-200/60 group"
                >
                  <div className="flex flex-col gap-1 pr-4">
                    <Text className="text-sm font-semibold text-gray-800 group-hover:text-blue-600 transition-colors">
                      {service.title}
                    </Text>
                    <div>
                      <span className="inline-block text-[10px] font-semibold tracking-wider text-gray-500 bg-gray-200/70 px-2 py-0.5 rounded-md uppercase">
                        {service.type}
                      </span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <Text className="text-base font-bold text-gray-900 bg-white px-3 py-1 rounded-lg border border-gray-200 shadow-sm inline-block">
                      {service.price
                        ? `$${service.price}`
                        : "Price Not Available"}
                    </Text>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Text type="secondary" className="text-sm">
                No additional services available for this provider.
              </Text>
            </div>
          )}
        </Modal>
      </div>
    </div>
  );
}
