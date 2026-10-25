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
  Select,
  Skeleton,
  Space,
  Switch,
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
            <Card title="Filters" size="small">
              <Space direction="vertical" style={{ width: "100%" }}>
                <Input.Search
                  placeholder="Search services"
                  value={filterState.searchQuery}
                  onChange={(e) =>
                    handleFilterChange({ searchQuery: e.target.value })
                  }
                  allowClear
                />
                <Select
                  mode="multiple"
                  placeholder="Service type"
                  style={{ width: "100%" }}
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
                <Select
                  mode="multiple"
                  placeholder="City"
                  style={{ width: "100%" }}
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
                  value={[...filterState.countries]}
                  onChange={(vals) =>
                    handleFilterChange({ countries: new Set(vals) })
                  }
                  options={countryOptions}
                />
                <Space>
                  <InputNumber
                    placeholder="Min price"
                    value={filterState.priceMin ?? undefined}
                    onChange={(v) =>
                      handleFilterChange({ priceMin: v ?? null })
                    }
                  />
                  <InputNumber
                    placeholder="Max price"
                    value={filterState.priceMax ?? undefined}
                    onChange={(v) =>
                      handleFilterChange({ priceMax: v ?? null })
                    }
                  />
                </Space>
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
                <div className="flex items-center justify-between">
                  <Text>Home test available</Text>
                  <Switch
                    checked={filterState.testAtHome === true}
                    onChange={(checked) =>
                      handleFilterChange({ testAtHome: checked ? true : null })
                    }
                  />
                </div>
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
                <Button
                  type="primary"
                  danger
                  onClick={() => {
                    setFilterState(parseFilterState(new URLSearchParams()));
                    router.replace("?", { scroll: false });
                  }}
                >
                  Reset filters
                </Button>
              </Space>
            </Card>
          </div>

          <div className="lg:col-span-3 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <Text strong>{visibleServices.length} services found</Text>
            </div>

            {pagedGroups.length > 0 ? (
              pagedGroups.map((group, idx) => (
                <Card key={idx} className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <Text strong>
                      {group.provider.providerInformation.companyName}
                    </Text>
                    <Text type="secondary">
                      {group.provider.providerInformation.rating ?? "No rating"}
                      ★ ({group.provider.providerInformation.reviewCount}{" "}
                      reviews)
                    </Text>
                  </div>
                  <Text type="secondary" className="block mb-3">
                    {group.provider.providerInformation.city.name},{" "}
                    {group.provider.providerInformation.country.name}
                  </Text>
                  <Space direction="vertical" style={{ width: "100%" }}>
                    {group.services.slice(0, 3).map((service, sIdx) => (
                      <div
                        key={sIdx}
                        className="flex items-center justify-between py-2 border-b last:border-0"
                      >
                        <div>
                          <Text>{service.title}</Text>
                          <div className="text-xs text-gray-500">
                            {service.type}
                          </div>
                        </div>
                        <Text>{service.price ?? "-"}</Text>
                      </div>
                    ))}
                  </Space>
                  {group.total > 3 && (
                    <Button
                      type="link"
                      size="small"
                      className="mt-2"
                      onClick={() => {
                        setModalProvider(group.provider);
                        setModalOpen(true);
                      }}
                    >
                      View all {group.total} services
                    </Button>
                  )}
                </Card>
              ))
            ) : (
              <Card>
                <Text type="secondary">
                  No services match your criteria. Try adjusting filters.
                </Text>
              </Card>
            )}

            {totalGroupPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-6">
                <Button
                  disabled={currentGroupPage <= 1}
                  onClick={() =>
                    handleFilterChange({ page: currentGroupPage - 1 })
                  }
                >
                  Previous
                </Button>
                <Text>
                  Page {currentGroupPage} of {totalGroupPages}
                </Text>
                <Button
                  disabled={currentGroupPage >= totalGroupPages}
                  onClick={() =>
                    handleFilterChange({ page: currentGroupPage + 1 })
                  }
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Services modal */}
        <Modal
          title={modalProvider?.providerInformation.companyName}
          open={modalOpen}
          onCancel={() => setModalOpen(false)}
          footer={null}
          width={720}
        >
          <Space direction="vertical" style={{ width: "100%" }}>
            {modalServices.map((service: any, idx: any) => (
              <div
                key={idx}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div>
                  <Text>{service.title}</Text>
                  <div className="text-xs text-gray-500">{service.type}</div>
                </div>
                <Text>{service.price ?? "-"}</Text>
              </div>
            ))}
          </Space>
        </Modal>
      </div>
    </div>
  );
}
