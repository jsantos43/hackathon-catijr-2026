import type { Bid, Participation } from '../types';
import api from './api';

/**
 * Leituras de lances pela API REST. Os lances são DADOS pelo socket (services/socket.ts,
 * evento auction:bid); aqui ficam só as consultas.
 */
export const bidService = {
  /** GET /auction/:id/bids — últimos lances, do mais recente para o mais antigo. */
  async list(auctionId: string, limit = 20): Promise<Bid[]> {
    const { data } = await api.get<{ bids: Bid[] }>(`/auction/${auctionId}/bids`, { params: { limit } });
    return data.bids;
  },

  /** GET /auction/participations — leilões em que dei lance, com a minha situação (RF27). */
  async participations(): Promise<Participation[]> {
    const { data } = await api.get<{ participations: Participation[] }>('/auction/participations');
    return data.participations;
  },
};
