import { createApiClient } from '@/lib/api';
import { automationBudget } from '@/lib/automation/budget';
import { authHeaders, readPageSession } from '@/lib/auth';
import { startCollectionEnhancements } from '@/lib/better/collection';
import { createCardsController } from '@/lib/better/cards';
import { createWishlistBadges } from '@/lib/better/wishlist-badges';
import { createOffersPage } from '@/lib/better/offers-page';
import { createCardWatch } from '@/lib/better/watchlist';
import { createCachedPriceService } from '@/lib/better/price-cache';
import { startRarityBorders } from '@/lib/better/rarity-borders';
import { startMarketWatchLoop, watchPassSucceeded } from '@/lib/doublons/market-watch';
import { startRepriceLoop } from '@/lib/doublons/reprice-watch';
import { circuitReporter, isCircuitOpen } from '@/lib/circuit-breaker';
import { loadWishlist } from '@/lib/doublons/wishlist';
import './market.css';
import './collection.css';
import './offers.css';

const LOCK_NAME = 'kyara-plus:prices';

export default defineContentScript({
  matches: ['https://kyara.games/*'],
  runAt: 'document_idle',
  main() {
    const service = createCachedPriceService({
      recentSalesRarities: true,
      getHeaders: () => authHeaders(readPageSession(window.localStorage)),
      storage: browser.storage.local as never,
      subscribe: (listener) =>
        browser.storage.onChanged.addListener((changes, area) => {
          if (area === 'local') listener(changes);
        }),
      lock: <T>(action: () => Promise<T>): Promise<T> =>
        navigator.locks?.request
          ? (navigator.locks.request(LOCK_NAME, action) as Promise<T>)
          : action(),
    });

    const wishlistApi = createApiClient({
      getSession: async () => readPageSession(window.localStorage),
      gate: () => automationBudget.take(),
    });
    createCardsController({
      document,
      location,
      service,
      extras: [
        createWishlistBadges({
          document,
          loadWishlist: () => loadWishlist(wishlistApi),
        }),
        createOffersPage({
          document,
          location,
          api: wishlistApi,
        }),
        createCardWatch({
          document,
          location,
          api: wishlistApi,
          cardName: (id) => service.peek(id)?.name ?? null,
        }),
      ],
    });
    const watchCircuit = circuitReporter('veille');
    const repriceCircuit = circuitReporter('repix');
    // Veille de prix : un contrôle par minute, une lecture seulement à l'intervalle réglé
    // et jamais dans un onglet masqué. Le coupe-circuit coupe aussi cette boucle.
    startMarketWatchLoop({
      api: wishlistApi,
      document,
      isEnabled: async () => !(await isCircuitOpen()),
      onResult: async (run) => {
        if (run.error && !run.auth) await watchCircuit.fail(run.error);
        else if (watchPassSucceeded(run)) await watchCircuit.ok();
      },
    });
    // Reprix automatique : inactif par défaut, une passe bornée à l'intervalle réglé.
    startRepriceLoop({
      api: wishlistApi,
      document,
      isEnabled: async () => !(await isCircuitOpen()),
      onResult: async (run) => {
        if (!run) return;
        if (run.error) await repriceCircuit.fail(run.error);
        else if (run.ok) await repriceCircuit.ok();
      },
    });
    startCollectionEnhancements({ document });
    startRarityBorders(document);
  },
});
