import { storage } from 'wxt/utils/storage';

export const statsWindowItem = storage.defineItem<number | null>('local:statsWindow', {
  fallback: null,
});

export interface WindowDeps {
  getSavedId: () => Promise<number | null>;
  saveId: (id: number | null) => Promise<void>;
  /** Doit échouer si la fenêtre n'existe plus. */
  getWindow: (id: number) => Promise<unknown>;
  focus: (id: number) => Promise<void>;
  create: () => Promise<number | undefined>;
}

let pending: Promise<{ id: number | null; reused: boolean }> | null = null;

/** Ouvre la fenêtre des statistiques, ou ramène au premier plan celle qui existe déjà. */
export function openOrFocusWindow(deps: WindowDeps) {
  pending ??= (async () => {
    const saved = await deps.getSavedId();
    if (saved !== null) {
      try {
        await deps.getWindow(saved);
        await deps.focus(saved);
        return { id: saved, reused: true };
      } catch {
        await deps.saveId(null);
      }
    }
    const id = (await deps.create()) ?? null;
    await deps.saveId(id);
    return { id, reused: false };
  })().finally(() => {
    pending = null;
  });
  return pending;
}

export function browserWindowDeps(url: string): WindowDeps {
  return {
    getSavedId: () => statsWindowItem.getValue(),
    saveId: (id) => statsWindowItem.setValue(id),
    getWindow: (id) => browser.windows.get(id),
    focus: async (id) => {
      await browser.windows.update(id, { focused: true, drawAttention: true });
    },
    create: async () =>
      (await browser.windows.create({ url, type: 'popup', width: 1100, height: 820 }))?.id,
  };
}
