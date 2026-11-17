import { createApiClient } from '@/lib/api';
import { createAntiAfk } from '@/lib/anti-afk';
import { readPageSession, type Session } from '@/lib/auth';
import { isContentRequest, type Message, type RelayResponse } from '@/lib/messages';
import { toRelayError } from '@/lib/relay';
import { getSettings, settingsItem } from '@/lib/settings';
import { normalizePacks } from '@/lib/auto-open/planner';
import { runAutoOpen } from '@/lib/auto-open/runner';
import {
  abortableSleep,
  appendAutoOpenLog,
  autoOpenStatusItem,
  packCatalogItem,
} from '@/lib/auto-open/storage';
import { automationBudget } from '@/lib/automation/budget';
import { createSupervisor, webLock } from '@/lib/supervisor';
import { appendAutoSellLog, autoSellStatusItem, runAutoSell } from '@/lib/doublons/auto-sell';
import { sellPricesItem } from '@/lib/doublons/market';
import { getSellSettings } from '@/lib/doublons/settings';
import { catalogItem } from '@/lib/stats/store';

const REFRESH_MS = 30_000;

export default defineContentScript({
  matches: ['https://kyara.games/*'],
  runAt: 'document_idle',
  main() {
    // Session : transmise au fond, qui la garde en mémoire de session seulement.
    let lastToken: string | null = null;

    const push = () => {
      const session: Session | null = readPageSession(window.localStorage);
      if (!session) {
        if (lastToken !== null) {
          lastToken = null;
          void browser.runtime.sendMessage<Message>({ type: 'auth:expired' }).catch(() => {});
        }
        return;
      }
      if (session.token === lastToken) return;
      lastToken = session.token;
      void browser.runtime.sendMessage<Message>({ type: 'auth:update', session }).catch(() => {});
    };

    push();
    setInterval(push, REFRESH_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) push();
    });

    // Client API : session lue dans la page au moment de chaque requête.
    const api = createApiClient({
      gate: () => automationBudget.take(), getSession: async () => readPageSession(window.localStorage) });

    const antiAfk = createAntiAfk({
      document,
      onEvent: (message) => void appendAutoOpenLog(message),
    });

    // Un seul onglet fait tourner chaque boucle (verrou Web Locks).
    const autoOpen = createSupervisor({
      isEnabled: async () => (await getSettings()).autoOpen,
      sleep: abortableSleep,
      withLock: webLock('kyara-plus:auto-open'),
      run: (signal) =>
        runAutoOpen(
          {
            api,
            getSettings,
            sleep: abortableSleep,
            now: Date.now,
            random: Math.random,
            log: (message) => void appendAutoOpenLog(message),
            report: (status) => void autoOpenStatusItem.setValue(status),
            onCatalog: (packs) => void packCatalogItem.setValue(packs),
          },
          signal,
        ),
    });

    const autoSell = createSupervisor({
      isEnabled: async () => (await getSettings()).autoSell,
      sleep: abortableSleep,
      withLock: webLock('kyara-plus:auto-sell'),
      run: (signal) =>
        runAutoSell(
          {
            api,
            isEnabled: async () => (await getSettings()).autoSell,
            getSettings: getSellSettings,
            getMeta: async () => {
              const cards = (await catalogItem.getValue())?.cards ?? [];
              return new Map(
                cards.map((card) => [
                  Number(card.id),
                  {
                    name: card.name ?? null,
                    image: card.image ?? null,
                    rarity: card.rarity,
                    series: card.series,
                  },
                ]),
              );
            },
            getPrices: async () =>
              new Map(
                Object.entries(await sellPricesItem.getValue()).map(([id, value]) => [
                  Number(id),
                  value,
                ]),
              ),
            sleep: abortableSleep,
            now: Date.now,
            log: (message, kind) => void appendAutoSellLog(message, kind),
            report: (status) => void autoSellStatusItem.setValue(status),
          },
          signal,
        ),
    });

    const applySettings = async () => {
      const settings = await getSettings();
      if (settings.antiAfk) antiAfk.start();
      else antiAfk.stop();
      await autoOpen.apply();
      await autoSell.apply();
    };
    void applySettings();
    settingsItem.watch(() => void applySettings());

    // Demandes des pages d'extension : liste des boosters, et relais de lectures API.
    // Réponse par sendResponse + `return true`, seule forme acceptée par Chrome et Firefox.
    browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
      if (sender.id !== browser.runtime.id || !isContentRequest(message)) return;
      const answer: Promise<unknown> =
        message.type === 'api:request'
          ? api
              .request<unknown>(message.path, {
                method: message.method,
                body: message.body,
                timeoutMs: message.timeoutMs,
              })
              .then((data): RelayResponse => ({ ok: true, data }))
              .catch(toRelayError)
          : api
              .request<unknown>('/api/packs', { timeoutMs: 25_000 })
              .then(async (data) => {
                const packs = normalizePacks(data);
                await packCatalogItem.setValue(packs);
                return { ok: true, count: packs.length };
              })
              .catch(() => ({ ok: false, count: 0 }));
      void answer.then(sendResponse);
      return true;
    });
  },
});
