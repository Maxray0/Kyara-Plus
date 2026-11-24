import { createApiClient } from '@/lib/api';
import { createAlertBell } from '@/lib/alerts/bell';
import { mountSiteAlertBell } from '@/lib/alerts/site';
import { readPageSession } from '@/lib/auth';
import { createPanel, type PanelController } from '@/lib/ui/panel';
import { createPanelViews } from '@/lib/ui/panel-views';

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
    // Tout est centralisé dans le panneau : l'engrenage ouvre l'onglet Réglages au lieu
    // du popup de la barre d'outils, qui reste disponible pour un accès rapide.
    const current: { panel?: PanelController } = {};
    current.panel = createPanel({
      tagline: 'Vente · échanges · statistiques',
      alertBell: alertBell.element,
      onSettings: () => current.panel?.openView('settings'),
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
