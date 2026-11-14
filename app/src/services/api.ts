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

// A API responde em inglês; traduz o que é comum para mostrar ao usuário.
const TRANSLATIONS: [RegExp, string][] = [
  [/Email or password is invalid/i, 'E-mail ou senha inválidos.'],
  [/email is already in use/i, 'Já existe uma conta com este e-mail.'],
  [/Password must be at least (\d+)/i, 'A senha precisa ter pelo menos $1 caracteres.'],
  [/Email is not valid/i, 'E-mail inválido.'],
  [/startsAt must be at least (\d+) seconds/i, 'O início precisa ser pelo menos $1 segundos à frente.'],
  [/startsAt must be at most/i, 'O início pode ser no máximo 30 dias à frente.'],
  [/Auctions with bids cannot be cancelled/i, 'Leilões com lances não podem ser cancelados.'],
  [/Only scheduled or running auctions can be cancelled/i, 'Só leilões agendados ou em andamento podem ser cancelados.'],
  [/Only text can be appended now/i, 'Agora só é possível acrescentar texto à descrição.'],
  [/send at least (\d+) photos/i, 'Envie pelo menos $1 fotos.'],
  [/only JPEG, PNG or WEBP/i, 'Só aceitamos fotos JPG, PNG ou WebP.'],
  [/File too large/i, 'Uma das fotos passa do limite de 5 MB.'],
  [/already sold/i, 'Um dos itens já foi vendido.'],
  [/already in a scheduled or running auction/i, 'Um dos itens já está em outro leilão agendado ou em andamento.'],
  [/Description must be at least (\d+)/i, 'A descrição precisa ter pelo menos $1 caracteres.'],
  [/Name must be at least (\d+)/i, 'O nome precisa ter pelo menos $1 caracteres.'],
  [/Title must be at least (\d+)/i, 'O título precisa ter pelo menos $1 caracteres.'],
];

const translate = (msg: string) => {
  const clean = msg.replace(/^[\w.]+: /, '');
  for (const [re, pt] of TRANSLATIONS) {
    const m = clean.match(re);
    if (m) return pt.replace(/\$(\d)/g, (_, i: string) => m[Number(i)] ?? '');
  }
  return clean;
};

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
