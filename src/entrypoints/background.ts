import { markSessionExpired, saveSession, sessionItem } from '@/lib/auth';
import { createOpenTabOpener } from '@/lib/extension-pages';
import { extensionPagePath, isMessage, type ExtensionPage } from '@/lib/messages';

const KYARA_ORIGIN = 'https://kyara.games';

export default defineBackground(() => {
  const tabDeps = {
    queryTabs: (pattern: string) => browser.tabs.query({ url: pattern }),
    createTab: async (url: string) => {
      await browser.tabs.create({ url });
    },
    activateTab: async (tabId: number) => {
      await browser.tabs.update(tabId, { active: true });
    },
    updateTab: async (tabId: number, url: string) => {
      await browser.tabs.update(tabId, { url });
    },
    focusWindow: async (windowId: number) => {
      await browser.windows.update(windowId, { focused: true });
    },
  };
  const openPopupTab = createOpenTabOpener(tabDeps, {
    // Si la recherche elle-même échoue, le repli reste dans la même promesse dédupliquée.
    createOnError: tabDeps.createTab,
  });

  /** Réglages réutilise son onglet ; les autres pages gardent l'ouverture directe. */
  async function openExtensionPage(page: ExtensionPage): Promise<void> {
    const url = browser.runtime.getURL(extensionPagePath(page));
    if (page !== 'popup') {
      await browser.tabs.create({ url });
      return;
    }

    try {
      await openPopupTab(url);
    } catch {
      // Le repli a déjà été tenté une seule fois si la recherche avait échoué.
    }
  }

  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    // Seuls nos content scripts, injectés sur kyara.games, peuvent nous écrire.
    if (sender.id !== browser.runtime.id || !sender.tab?.url?.startsWith(KYARA_ORIGIN + '/')) {
      return;
    }
    if (!isMessage(message)) return;

    if (message.type === 'ui:open') {
      void openExtensionPage(message.page);
      return;
    }

    if (message.type === 'auth:update') {
      void saveSession(message.session).then(() => browser.action.setBadgeText({ text: '' }));
    } else {
      void markSessionExpired().then(() => {
        void browser.action.setBadgeBackgroundColor({ color: '#c0392b' });
        return browser.action.setBadgeText({ text: '!' });
      });
    }
  });

  // Le badge « ! » ne doit pas survivre à une session retrouvée.
  void sessionItem.getValue().then((session) => {
    if (session) void browser.action.setBadgeText({ text: '' });
  });
});
