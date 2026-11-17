import { storage } from 'wxt/utils/storage';
import { normalizeData, type CatalogCard, type StatData } from './model';

export const statsItem = storage.defineItem<StatData | null>('local:statboard', {
  fallback: null,
  version: 1,
});

export const catalogItem = storage.defineItem<{ at: number; cards: CatalogCard[] } | null>(
  'local:catalog',
  { fallback: null, version: 1 },
);

export async function loadStats(): Promise<StatData> {
  return normalizeData(await statsItem.getValue());
}

export const saveStats = (data: StatData) => statsItem.setValue(data);

export const CATALOG_TTL_MS = 24 * 3600 * 1000;
