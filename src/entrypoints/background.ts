import { markSessionExpired, saveSession, sessionItem } from '@/lib/auth';
import { extensionPagePath, isMessage } from '@/lib/messages';

const KYARA_ORIGIN = 'https://kyara.games';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    // Seuls nos content scripts, injectés sur kyara.games, peuvent nous écrire.
    if (sender.id !== browser.runtime.id || !sender.tab?.url?.startsWith(KYARA_ORIGIN + '/')) {
      return;
    }
    if (!isMessage(message)) return;

    if (message.type === 'ui:open') {
      const url = browser.runtime.getURL(extensionPagePath(message.page));
      void browser.tabs.create({ url });
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
