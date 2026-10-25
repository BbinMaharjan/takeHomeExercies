import rawDataset from "@/data/task1-service-explorer.json";
import type { Category, Provider, Service } from "@/types/domain";

export interface Dataset {
  categories: Category[];
  providers: Provider[];
  services: Service[];
}

export const dataset = rawDataset as Dataset;