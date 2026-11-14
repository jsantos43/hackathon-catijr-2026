/**
 * Rotas que o front já usa, mas que a API AINDA NÃO TEM. Cada função tenta a rota real e, se a
 * API responder "Route ... not found" (404 do handleNotFound), devolve uma resposta genérica.
 * Assim, quando o back implementar a rota com o contrato descrito aqui (e no AGENTS.md), o front
 * passa a usá-la sem mudar nada.
 *
 * Para desligar as respostas genéricas: VITE_PENDING_FALLBACK=false.
 */
import { PENDING_FALLBACK } from '../config';
import type { Auction, Bid, Participation } from '../types';
import api, { isMissingRoute } from './api';
import { auctionService } from './auctionService';

const withFallback = async <T>(name: string, call: () => Promise<T>, generic: () => T | Promise<T>) => {
  try {
    return await call();
  } catch (err) {
    if (PENDING_FALLBACK && isMissingRoute(err)) {
      console.info(`[pendente] ${name}: rota ainda não existe na API, usando resposta genérica.`);
      return generic();
    }
    throw err;
  }
};

export const pendingService = {
  /**
   * PENDENTE · GET /auction/:id/bids?limit=20
   * Resposta esperada: { success, bids: Bid[] } (mais recente primeiro; bidderName já no
   * formato "Marina T.").
   * Genérica: lista vazia (a sala vai acumulando os lances que chegam pelo socket).
   */
  async bids(auctionId: string): Promise<Bid[]> {
    return withFallback(
      'GET /auction/:id/bids',
      async () => (await api.get<{ bids: Bid[] }>(`/auction/${auctionId}/bids`, { params: { limit: 20 } })).data.bids,
      () => [],
    );
  },

  /**
   * PENDENTE · GET /auction/participations
   * Leilões em que o usuário deu lance (RF27), com o maior lance dele e a situação.
   * Resposta esperada: { success, participations: Participation[] }.
   * Genérica: usa o histórico de vitórias (GET /auction/history, que já existe) como
   * "Vencedor"; os demais estados (Líder/Superado/Não venceu) ficam vazios até a rota existir.
   */
  async participations(): Promise<{ list: Participation[]; generic: boolean }> {
    return withFallback<{ list: Participation[]; generic: boolean }>(
      'GET /auction/participations',
      async () => ({
        list: (await api.get<{ participations: Participation[] }>('/auction/participations')).data.participations,
        generic: false,
      }),
      async () => {
        const won = await auctionService.listWon({ pageSize: 50 });
        return {
          generic: true,
          list: won.items.map((auction: Auction) => ({
            auction,
            myHighestBidCents: auction.finalPriceCents ?? 0,
            situation: 'WON' as const,
          })),
        };
      },
    );
  },
};
