import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { API_URL } from '../config';
import { syncServerTime } from '../lib/serverClock';
import type { ApiErrorBody } from '../types';

const baseURL = API_URL;

// withCredentials: a sessão vive em cookies httpOnly (accessToken + refreshToken).
const api = axios.create({ baseURL, withCredentials: true });
const refreshClient = axios.create({ baseURL, withCredentials: true });

interface RetryConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
  _sentAt?: number;
}

api.interceptors.request.use((config) => {
  (config as RetryConfig)._sentAt = Date.now();
  return config;
});

let refreshPromise: Promise<unknown> | null = null;

api.interceptors.response.use(
  (response) => {
    // Sincroniza o relógio com o servidor sempre que a resposta trouxer serverTime (RF16).
    const data = response.data as { serverTime?: string } | undefined;
    syncServerTime(data?.serverTime, (response.config as RetryConfig)._sentAt);
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryConfig | undefined;

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      originalRequest.url?.includes('/auth/login') ||
      originalRequest.url?.includes('/auth/refresh') ||
      originalRequest.url?.includes('/auth/logout')
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      // Um único refresh por vez, mesmo com várias requisições falhando juntas.
      refreshPromise ??= refreshClient.post('/auth/refresh').finally(() => {
        refreshPromise = null;
      });
      await refreshPromise;

      return api(originalRequest);
    } catch {
      window.dispatchEvent(new Event('auth:expired'));
      return Promise.reject(error);
    }
  },
);

/** Renova a sessão (usado pelo socket quando o handshake é recusado). */
export const refreshSession = () => refreshClient.post('/auth/refresh');

// A API já responde em português; só tira o prefixo do campo ("name: ...", "images: ...").
const translate = (msg: string) => msg.replace(/^[\w.]+: /, '');

/** Mensagem legível de um erro da API (ou de rede). */
export const errorMessage = (err: unknown, fallback = 'Algo deu errado. Tente de novo.') => {
  if (axios.isAxiosError(err)) {
    if (!err.response) return 'Sem conexão com o servidor. Verifique sua internet.';
    const body = err.response.data as Partial<ApiErrorBody> | undefined;
    if (body?.details?.length) return body.details.map(translate).join(' ');
    if (body?.message) return translate(body.message);
  }
  return fallback;
};

/**
 * true quando a rota não existe na API: 404 do handleNotFound (não "recurso não encontrado"),
 * ou 400 "id: ... UUID" quando o caminho novo caiu numa rota com :id (ex.: /auction/:id).
 */
export const isMissingRoute = (err: unknown) => {
  if (!axios.isAxiosError(err) || !err.response) return false;
  const body = (err.response.data ?? {}) as Partial<ApiErrorBody>;
  if (err.response.status === 404) {
    return [body.message, ...(body.details ?? [])].some((m) => /^Route /.test(m ?? ''));
  }
  if (err.response.status === 400) return (body.details ?? []).some((d) => /^id: .*UUID/i.test(d));
  return false;
};

export default api;
