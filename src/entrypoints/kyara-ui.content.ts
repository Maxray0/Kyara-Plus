import { createApiClient } from '@/lib/api';
import { createAlertBell } from '@/lib/alerts/bell';
import { mountSiteAlertBell } from '@/lib/alerts/site';
import { readPageSession } from '@/lib/auth';
import type { ExtensionPage } from '@/lib/messages';
import { createPanel } from '@/lib/ui/panel';
import { createPanelViews } from '@/lib/ui/panel-views';

function openPage(page: ExtensionPage): void {
  void browser.runtime.sendMessage({ type: 'ui:open', page }).catch(() => {});
}

export default defineContentScript({
  matches: ['https://kyara.games/*'],
  runAt: 'document_idle',
  main() {
    if (document.getElementById('kyara-plus-ui')) return;

    const api = createApiClient({
      getSession: async () => readPageSession(window.localStorage),
    });

    const alertBell = createAlertBell();
    mountSiteAlertBell({ document });
    createPanel({
      tagline: 'Vente · échanges · statistiques',
      alertBell: alertBell.element,
      onSettings: () => openPage('popup'),
      getStatus: () => {
        try {
          const connected = Boolean(readPageSession(window.localStorage));
          return { label: connected ? 'Connecté' : 'Hors connexion', ok: connected };
        } catch {
          return { label: 'Hors connexion', ok: false };
        }
      },
      views: createPanelViews({ api }),
    });
  },
});
