import { storage } from 'wxt/utils/storage';

export type Strategy = 'median7d' | 'median30d' | 'lastPrice' | 'medianRecent' | 'minRecent';
export type Preset = 'fast' | 'market' | 'max' | 'custom';
export type Order = 'priceDesc' | 'priceAsc' | 'oldest' | 'newest';

/** Raretés proposées pour la vente automatique, de la plus commune à la plus rare. */
export const AUTO_RARITIES = [
  { code: 'C', label: 'Commun' },
  { code: 'U', label: 'Peu commun' },
  { code: 'R', label: 'Rare' },
  { code: 'E', label: 'Épique' },
  { code: 'L', label: 'Légendaire' },
  { code: 'M', label: 'Mythique' },
] as const;

export type AutoRarity = (typeof AUTO_RARITIES)[number]['code'];

const AUTO_RARITY_CODES: AutoRarity[] = AUTO_RARITIES.map((r) => r.code);

/**
 * Code de rareté utilisable par les réglages. Kyara marque parfois les cartes spéciales `S` :
 * elles suivent les légendaires. Un code inconnu renvoie null.
 */
export function autoRarityOf(rarity: string | null | undefined): AutoRarity | null {
  const code = String(rarity ?? '').toUpperCase();
  if (code === 'S') return 'L';
  return AUTO_RARITY_CODES.includes(code as AutoRarity) ? (code as AutoRarity) : null;
}

/**
 * La vente automatique ne touche que les raretés cochées. Une rareté inconnue (catalogue pas
 * encore chargé) n'est jamais vendue : sans information, une mythique pourrait partir seule.
 */
export function autoSellAllowed(s: SellSettings, rarity: string | null | undefined): boolean {
  const code = autoRarityOf(rarity);
  return code !== null && s.autoRarities.includes(code);
}

export interface SellSettings {
  /** Exemplaires à garder par personnage. */
  keep: number;
  strategy: Strategy;
  pricePreset: Preset;
  /** Ajustement en % (mode personnalisé). */
  adjustPct: number;
  minPrice: number;
  /** Ventes minimales sur 30 jours pour estimer un prix. */
  minSales: number;
  /** Se rabattre sur la médiane 30 j si la stratégie choisie n'a pas de valeur. */
  fallback: boolean;
  durationHours: number;
  maxSlots: number;
  order: Order;
  /** Minutes entre deux passages de la vente automatique (5 minimum). */
  intervalMin: number;
  /** Heure d'ouverture de la plage de vente automatique (0-23). */
  autoFromHour: number;
  /** Heure de fermeture (exclue) ; égale à l'ouverture pour vendre toute la journée. */
  autoToHour: number;
  /** Annonces maximales par passage, quel que soit le nombre de places libres. */
  autoMaxPerPass: number;
  /** Raretés que la vente automatique a le droit de mettre en vente. */
  autoRarities: AutoRarity[];
  /** Identifiants à ne jamais vendre, séparés par espaces, virgules ou points-virgules. */
  exclude: string;
}

export const DEFAULT_SELL_SETTINGS: Readonly<SellSettings> = {
  keep: 1,
  strategy: 'median7d',
  pricePreset: 'market',
  adjustPct: 0,
  minPrice: 1,
  minSales: 3,
  fallback: true,
  durationHours: 12,
  maxSlots: 5,
  order: 'priceDesc',
  intervalMin: 10,
  autoFromHour: 0,
  autoToHour: 0,
  autoMaxPerPass: 5,
  // Les légendaires et mythiques restent en collection : trop rares pour partir seuls.
  autoRarities: ['C', 'U', 'R', 'E'],
  exclude: '',
};

export const PRESETS: Record<
  Exclude<Preset, 'custom'>,
  { adjust: number; label: string; hint: string }
> = {
  fast: { adjust: -10, label: 'Vendre vite', hint: '10 % sous la médiane' },
  market: { adjust: 0, label: 'Prix du marché', hint: 'médiane des 7 derniers jours' },
  max: { adjust: 10, label: 'Maximiser', hint: '10 % au-dessus de la médiane' },
};

const STRATEGIES: Strategy[] = ['median7d', 'median30d', 'lastPrice', 'medianRecent', 'minRecent'];
const PRESET_KEYS: Preset[] = ['fast', 'market', 'max', 'custom'];
const ORDERS: Order[] = ['priceDesc', 'priceAsc', 'oldest', 'newest'];

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/** Revalide les réglages relus du stockage : toute valeur douteuse retombe sur le défaut. */
export function normalizeSellSettings(raw: unknown): SellSettings {
  const s = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SELL_SETTINGS;
  return {
    keep: bounded(s.keep, 0, 20, d.keep),
    strategy: STRATEGIES.includes(s.strategy as Strategy) ? (s.strategy as Strategy) : d.strategy,
    pricePreset: PRESET_KEYS.includes(s.pricePreset as Preset)
      ? (s.pricePreset as Preset)
      : d.pricePreset,
    adjustPct: bounded(s.adjustPct, -90, 500, d.adjustPct),
    minPrice: bounded(s.minPrice, 1, 1_000_000, d.minPrice),
    minSales: bounded(s.minSales, 0, 1000, d.minSales),
    fallback: s.fallback !== false,
    durationHours: bounded(s.durationHours, 1, 168, d.durationHours),
    maxSlots: bounded(s.maxSlots, 1, 100, d.maxSlots),
    order: ORDERS.includes(s.order as Order) ? (s.order as Order) : d.order,
    intervalMin: bounded(s.intervalMin, 5, 120, d.intervalMin),
    autoFromHour: bounded(s.autoFromHour, 0, 23, d.autoFromHour),
    autoToHour: bounded(s.autoToHour, 0, 23, d.autoToHour),
    autoMaxPerPass: bounded(s.autoMaxPerPass, 1, 20, d.autoMaxPerPass),
    autoRarities: Array.isArray(s.autoRarities)
      ? AUTO_RARITY_CODES.filter((code) => (s.autoRarities as unknown[]).includes(code))
      : [...d.autoRarities],
    exclude: typeof s.exclude === 'string' ? s.exclude.slice(0, 2000) : '',
  };
}

export const sellSettingsItem = storage.defineItem<SellSettings>('local:sellSettings', {
  fallback: { ...DEFAULT_SELL_SETTINGS },
  version: 1,
});

export async function getSellSettings(): Promise<SellSettings> {
  return normalizeSellSettings(await sellSettingsItem.getValue());
}
