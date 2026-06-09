export interface FundamentalSourceConfig {
  id: string;
  name: string;
  type: 'rss' | 'api' | 'playwright' | 'manual';
  enabled: boolean;
  url?: string;
  categories?: string[];
}

export const FUNDAMENTAL_SOURCES: FundamentalSourceConfig[] = [];
