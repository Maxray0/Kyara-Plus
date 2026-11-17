import { call, type Api, type CallResult } from './market';
import { invalidateOwnedCache } from './owned-cache';
import { parseIds } from './pricing';
import type { SellSettings } from './settings';

/**
 * Ajoute un identifiant à la liste « ne jamais vendre », sans doublon et dans un ordre stable.
 * L'identifiant invalide ne modifie pas les réglages.
 */
export function withExcludedId(settings: SellSettings, id: number): SellSettings {
  if (!Number.isSafeInteger(id) || id < 1) return settings;
  const ids = parseIds(settings.exclude);
  if (ids.has(id)) return settings;
  ids.add(id);
  return {
    ...settings,
    exclude: [...ids].sort((a, b) => a - b).join(', '),
  };
}

/**
 * Pose ou retire le cadenas de Kyara. La page d'extension passe par le relais ;
 * l'appel n'est jamais fait directement depuis l'origine de l'extension.
 */
export async function pinCard(api: Api, id: number, pinned = true): Promise<CallResult> {
  if (!Number.isSafeInteger(id) || id < 1) {
    return {
      ok: false,
      status: 0,
      data: null,
      message: 'Carte invalide',
      code: 'invalid_id',
    };
  }
  const result = await call(api, `/api/me/collection/${id}/pin`, {
    method: 'POST',
    body: { pinned: !!pinned },
  });
  // Le cadenas change les copies disponibles à la vente : la possession est relue.
  if (result.ok) await invalidateOwnedCache('épingle');
  return result;
}
