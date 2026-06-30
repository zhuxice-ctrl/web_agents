import type { AdapterStatus, InsertResult, ProviderId } from "../shared/types";

export type ProviderDefinition = {
  id: ProviderId;
  label: string;
  hostnames: string[];
  defaultUrl: string;
  inputSelectors: string[];
};

export type SiteAdapter = {
  provider: ProviderId;
  detect(): Promise<AdapterStatus>;
  insertText(text: string): Promise<InsertResult>;
};
