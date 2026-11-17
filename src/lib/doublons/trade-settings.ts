import { storage } from 'wxt/utils/storage';

/** Réglages de l'onglet Échanges (comptoir). Les valeurs par défaut sont celles du legacy. */
export interface TradeSettings {
  /** Écart de valeur accepté pour un bon échange, en %. */
  tradeTol: number;
  /** Exiger une rareté reçue au moins égale à celle donnée. */
  tradeSameRarity: boolean;
  /** Autoriser à donner sa dernière copie si le gain est suffisant. */
  tradeUseLast: boolean;
  /** Gain minimal, en %, pour donner sa dernière copie. */
  tradeLastGain: number;
  /** Intervalle d'actualisation automatique du comptoir, en minutes ; 0 le désactive. */
  tradeRefreshMin: number;
}

export const DEFAULT_TRADE_SETTINGS: Readonly<TradeSettings> = {
  tradeTol: 20,
  tradeSameRarity: true,
  tradeUseLast: false,
  tradeLastGain: 20,
  tradeRefreshMin: 5,
};

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/** Revalide les réglages relus du stockage : toute valeur douteuse retombe sur le défaut. */
export function normalizeTradeSettings(raw: unknown): TradeSettings {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_TRADE_SETTINGS;
  return {
    tradeTol: bounded(source.tradeTol, 0, 100, d.tradeTol),
    tradeSameRarity: source.tradeSameRarity !== false,
    tradeUseLast: source.tradeUseLast === true,
    tradeLastGain: bounded(source.tradeLastGain, 0, 500, d.tradeLastGain),
    tradeRefreshMin: bounded(source.tradeRefreshMin, 0, 60, d.tradeRefreshMin),
  };
}

export const tradeSettingsItem = storage.defineItem<TradeSettings>('local:tradeSettings', {
  fallback: { ...DEFAULT_TRADE_SETTINGS },
  version: 1,
});

export async function getTradeSettings(): Promise<TradeSettings> {
  return normalizeTradeSettings(await tradeSettingsItem.getValue());
}
