import type { AdapterStatus, InsertResult, ProviderId, ResponseSnapshot } from "../shared/types";
import type { ProviderCatalogEntry } from "../providers/catalog";

export type ProviderDefinition = ProviderCatalogEntry;

export type SiteAdapter = {
  provider: ProviderId;
  detect(): Promise<AdapterStatus>;
  insertText(text: string): Promise<InsertResult>;
  captureLatestResponse?(): Promise<ResponseSnapshot | null>;
};

export type RuntimeSiteAdapter = SiteAdapter & {
  detectSync(): AdapterStatus;
  captureLatestResponseSync(): ResponseSnapshot | null;
};
