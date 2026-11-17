export const POPUP_TABS = ['settings', 'sell', 'trades', 'wishes', 'stats'] as const;

export type PopupTab = (typeof POPUP_TABS)[number];

const HASHES: Record<PopupTab, string> = {
  settings: '#reglages',
  sell: '#vente',
  trades: '#echanges',
  wishes: '#envies',
  stats: '#stats',
};

/** Fragment accepté vers l'onglet correspondant ; tout le reste retombe sur Réglages. */
export function popupTabFromHash(hash: string): PopupTab {
  const value = hash.replace(/^#/, '');
  if (value === 'reglages' || value === 'settings') return 'settings';
  if (value === 'vente') return 'sell';
  if (value === 'echanges') return 'trades';
  if (value === 'envies') return 'wishes';
  return POPUP_TABS.find((tab) => tab === value) ?? 'settings';
}

export function popupTabHash(tab: PopupTab): string {
  return HASHES[tab];
}
