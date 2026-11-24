import { ApiError, AuthError, PassRequiredError, RateLimitedError, type ApiClient } from './api';
import type { ContentRequest, RelayResponse } from './messages';
import { isRelayWritable } from './messages';
import { recordWriteRequest } from './write-log';

export function toRelayError(error: unknown): RelayResponse {
  if (error instanceof ApiError) {
    return {
      ok: false,
      status: error.status,
      code: error.code,
      message: error.message,
      data: error.data,
    };
  }
  return {
    ok: false,
    status: 0,
    code: null,
    message: error instanceof Error ? error.message : 'erreur inconnue',
  };
}

export function fromRelayError(response: Extract<RelayResponse, { ok: false }>): ApiError {
  if (response.status === 401) return new AuthError(response.message);
  if (response.code === 'pass_required') return new PassRequiredError(response.status);
  if (response.status === 429) return new RateLimitedError();
  return new ApiError(response.status, response.message, response.code, response.data);
}

export interface TabLike {
  id?: number;
  active?: boolean;
}

export interface RelayDeps {
  queryTabs: () => Promise<TabLike[]>;
  sendToTab: (tabId: number, request: ContentRequest) => Promise<unknown>;
}

/**
 * Client API pour les pages d'extension : la requête est exécutée par le content script d'un
 * onglet kyara.games ouvert, depuis l'origine du site. Lectures (GET) et quelques écritures
 * précises (voir `isRelayWritable`).
 */
export function createRelayClient(deps: RelayDeps): Pick<ApiClient, 'request'> {
  return {
    async request<T = unknown>(
      path: string,
      options: { method?: string; body?: unknown; timeoutMs?: number } = {},
    ): Promise<T> {
      const method = options.method === 'POST' || options.method === 'PUT' ? options.method : 'GET';
      if (options.method && options.method !== 'GET' && method === 'GET') {
        throw new ApiError(0, 'Méthode non relayée', 'method_not_relayed');
      }
      if (method !== 'GET' && !isRelayWritable(path, method)) {
        throw new ApiError(0, 'Écriture non autorisée par le relais', 'write_not_allowed');
      }
      const tabs = (await deps.queryTabs()).filter((tab) => tab.id !== undefined);
      if (!tabs.length) {
        throw new ApiError(
          0,
          'Ouvre kyara.games dans un onglet pour lire les données.',
          'no_kyara_tab',
        );
      }
      tabs.sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)));
      for (const tab of tabs) {
        let response: unknown;
        try {
          response = await deps.sendToTab(tab.id as number, {
            type: 'api:request',
            path,
            method,
            body: options.body,
            timeoutMs: options.timeoutMs,
          });
        } catch {
          // Onglet sans content script (ouvert avant l'installation) : on essaie le suivant.
          continue;
        }
        const result = response as RelayResponse | undefined;
        if (!result) continue;
        // Une écriture relayée entre au journal, réussie ou refusée par le site.
        if (method !== 'GET') {
          recordWriteRequest(
            method,
            path,
            options.body,
            result.ok
              ? { ok: true, status: null, error: null }
              : { ok: false, status: result.status, error: result.message },
          );
        }
        if (result.ok) return result.data as T;
        throw fromRelayError(result);
      }
      throw new ApiError(
        0,
        'Recharge l’onglet kyara.games (F5) puis réessaie.',
        'kyara_tab_unready',
      );
    },
  };
}
