import { AuthError, type ApiClient } from './api';
import type { CatalogCard } from './stats/model';
import { fetchCatalog } from './stats/remote';
import { CATALOG_TTL_MS, catalogItem } from './stats/store';

/**
 * Catalogue des cartes (id, nom, série, rareté, image), gardé 24 h. Un catalogue sans noms,
 * enregistré par une ancienne version, est relu.
 */
export async function getCatalog(api: Pick<ApiClient, 'request'>): Promise<CatalogCard[]> {
  const cached = await catalogItem.getValue();
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS && cached.cards.some((c) => c.name)) {
    return cached.cards;
  }
  try {
    const cards = await fetchCatalog(api);
    if (cards.length) await catalogItem.setValue({ at: Date.now(), cards });
    return cards.length ? cards : (cached?.cards ?? []);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    return cached?.cards ?? [];
  }
}
