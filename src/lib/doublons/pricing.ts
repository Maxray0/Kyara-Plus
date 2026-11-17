import { PRESETS, type SellSettings } from './settings';

/** Réponse de /api/market/prices/{id}, lue sans en supposer tous les champs. */
export interface PriceData {
  median7d?: number | null;
  median30d?: number | null;
  lastPrice?: number | null;
  sales30d?: number | null;
  lastSales?: { price?: number }[];
  [key: string]: unknown;
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? (sorted[mid] ?? null)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function parseIds(text: string | null | undefined): Set<number> {
  return new Set(
    String(text ?? '')
      .split(/[\s,;]+/)
      .map((part) => parseInt(part, 10))
      .filter((n) => !Number.isNaN(n)),
  );
}

// Bornes de prix du marché : le format exact n'est pas documenté. On cherche des champs du genre
// min/max, floor/ceiling… Dans les prix, « min » et « max » tout courts peuvent vouloir dire
// « annonce la moins ou la plus chère » : on ne les prend que dans un bloc explicite ou une erreur.
const MIN_STRICT =
  /^(floor|price_?floor|min_?allowed|min_?listing(_?price)?|listing_?min|allowed_?min|price_?min)$/i;
const MAX_STRICT =
  /^(ceiling|price_?ceiling|max_?allowed|max_?listing(_?price)?|listing_?max|allowed_?max|price_?max)$/i;
const MIN_LOOSE = /^(min|minimum|min_?price|lower)$/i;
const MAX_LOOSE = /^(max|maximum|max_?price|upper)$/i;
const BOUND_BOX =
  /^(bounds|limits|range|price_?bounds|price_?limits|price_?range|allowed|listing_?bounds|listing_?limits)$/i;

export interface Bounds {
  min: number | null;
  max: number | null;
}

export function boundsFrom(obj: unknown, loose = false, depth = 0): Bounds {
  const out: Bounds = { min: null, max: null };
  if (!obj || typeof obj !== 'object' || depth > 2) return out;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof value === 'number' && value > 0) {
      if ((MIN_STRICT.test(key) || (loose && MIN_LOOSE.test(key))) && out.min === null)
        out.min = value;
      if ((MAX_STRICT.test(key) || (loose && MAX_LOOSE.test(key))) && out.max === null)
        out.max = value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sub = boundsFrom(value, loose || BOUND_BOX.test(key), depth + 1);
      out.min ??= sub.min;
      out.max ??= sub.max;
    }
  }
  return out;
}

const digits = (text: string | undefined) => Number(String(text ?? '').replace(/[^\d]/g, ''));

/** Bornes lues dans une réponse d'erreur : « entre 5 et 120 », « maximum 120 », « min 5 ». */
export function boundsFromError(data: unknown, message = ''): Bounds {
  const bounds = boundsFrom(data, true);
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const reasons = Array.isArray(record.reasons) ? record.reasons : [];
  const text = [record.message, record.error, record.reason, ...reasons, message]
    .filter(Boolean)
    .join(' ');
  const between = text.match(/(?:entre|between)\D*?(\d[\d' .]*)\D+?(\d[\d' .]*)/i);
  if (between) {
    bounds.min ??= digits(between[1]);
    bounds.max ??= digits(between[2]);
  }
  const max = text.match(/(?:max(?:imum|imal)?|au plus|plafond|<=?)\D{0,30}(\d[\d' .]*)/i);
  const min = text.match(/(?:min(?:imum|imal)?|au moins|plancher|>=?)\D{0,30}(\d[\d' .]*)/i);
  if (max && bounds.max === null) bounds.max = digits(max[1]);
  if (min && bounds.min === null) bounds.min = digits(min[1]);
  return bounds;
}

export function clampPrice(price: number, bounds: Bounds | null): number {
  let p = price;
  if (bounds?.max && bounds.max > 0 && p > bounds.max) p = Math.floor(bounds.max);
  if (bounds?.min && bounds.min > 0 && p < bounds.min) p = Math.ceil(bounds.min);
  return p;
}

export interface Computed {
  price: number | null;
  base?: number;
  why: string;
  clamped?: 'min' | 'max' | null;
}

/** Prix de vente conseillé d'un doublon, à partir des prix du marché et des réglages. */
export function computePrice(p: PriceData | null, s: SellSettings): Computed {
  if (!p) return { price: null, why: 'pas de données' };
  const sales = (p.lastSales ?? []).map((x) => Number(x.price)).filter((n) => n > 0);
  const nSales = p.sales30d ?? sales.length;
  if (nSales < s.minSales) {
    return {
      price: null,
      why: `Trop peu vendu pour estimer un prix (${nSales} vente${nSales > 1 ? 's' : ''} en 30 jours)`,
    };
  }
  const values: Record<SellSettings['strategy'], number | null | undefined> = {
    median7d: p.median7d,
    median30d: p.median30d,
    lastPrice: p.lastPrice,
    medianRecent: median(sales),
    minRecent: sales.length ? Math.min(...sales) : null,
  };
  const preset = s.pricePreset === 'custom' ? null : PRESETS[s.pricePreset];
  const strategy = preset ? 'median7d' : s.strategy;
  const adjust = preset ? preset.adjust : s.adjustPct;
  let base = values[strategy];
  if (!(Number(base) > 0) && s.fallback) base = p.median30d || p.median7d || p.lastPrice;
  if (!(Number(base) > 0)) return { price: null, why: 'Aucun prix de marché connu' };
  const raw = Math.max(s.minPrice, Math.round(Number(base) * (1 + adjust / 100)));
  const price = clampPrice(raw, boundsFrom(p));
  return {
    price,
    base: Math.round(Number(base)),
    why: '',
    clamped: price !== raw ? (price < raw ? 'max' : 'min') : null,
  };
}
