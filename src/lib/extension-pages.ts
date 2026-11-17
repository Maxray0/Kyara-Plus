/** Onglet minimal nécessaire pour retrouver une page d'extension déjà ouverte. */
export interface ExtensionTabRef {
  id?: number;
  windowId?: number;
  url?: string;
}

export interface OpenOrFocusDeps {
  /** Reçoit un motif d'URL, par exemple `chrome-extension://<id>/popup.html*`. */
  queryTabs: (pattern: string) => Promise<readonly ExtensionTabRef[]>;
  createTab: (url: string) => Promise<unknown>;
  activateTab: (tabId: number) => Promise<unknown>;
  updateTab: (tabId: number, url: string) => Promise<unknown>;
  focusWindow?: (windowId: number) => Promise<unknown>;
}

export type OpenOrFocusResult = 'created' | 'reused';

export interface OpenTabOpenerOptions {
  /** Repli exécuté une seule fois si la recherche d'onglet échoue. */
  createOnError?: (url: string) => Promise<unknown>;
}

/**
 * Ouvre `targetUrl` ou réactive l'onglet déjà ouvert sur la même page, fragment ignoré.
 * Si l'onglet existe mais n'est pas sur le bon fragment, il y est ramené sans en créer un autre.
 */
export async function openOrFocusTab(
  targetUrl: string,
  deps: OpenOrFocusDeps,
): Promise<OpenOrFocusResult> {
  const base = targetUrl.split('#')[0] ?? targetUrl;
  const tabs = await deps.queryTabs(`${base}*`);
  const existing = tabs.find(
    (tab) =>
      tab.id !== undefined &&
      typeof tab.url === 'string' &&
      tab.url.split('#')[0] === base,
  );

  if (!existing || existing.id === undefined) {
    await deps.createTab(targetUrl);
    return 'created';
  }

  await deps.activateTab(existing.id);
  if (existing.windowId !== undefined) await deps.focusWindow?.(existing.windowId);
  if (existing.url !== targetUrl) await deps.updateTab(existing.id, targetUrl);
  return 'reused';
}

/**
 * Sérialise les ouvertures d'une même page : deux clics rapprochés partagent la même
 * recherche et ne peuvent pas créer deux onglets avant que le premier appel soit fini.
 */
export function createOpenTabOpener(
  deps: OpenOrFocusDeps,
  options: OpenTabOpenerOptions = {},
) {
  const pending = new Map<string, Promise<OpenOrFocusResult>>();

  return function open(targetUrl: string): Promise<OpenOrFocusResult> {
    const key = targetUrl.split('#')[0] ?? targetUrl;
    const running = pending.get(key);
    if (running) return running;

    const task = openOrFocusTab(targetUrl, deps)
      .catch(async (error) => {
        if (!options.createOnError) throw error;
        await options.createOnError(targetUrl);
        return 'created' as const;
      })
      .finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  };
}
