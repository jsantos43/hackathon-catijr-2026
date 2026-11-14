import type { Auction, AuctionStatus, Category, Paginated } from '../types';
import api from './api';

/** Ordenação feita no servidor (GET /auction/all?sort=). */
export type AuctionSort = 'ends' | 'starts' | 'price' | 'bids';

export interface ListQuery {
  q?: string;
  sort?: AuctionSort;
  category?: Category[];
  status?: AuctionStatus[];
  ownerId?: string;
  page?: number;
  pageSize?: number;
}

interface ListResponse {
  auctions: Auction[];
  page: number;
  pageSize: number;
  total: number;
  serverTime: string;
}

const toParams = (q: ListQuery) => ({
  q: q.q?.trim() || undefined,
  category: q.category?.length ? q.category.join(',') : undefined,
  status: q.status?.length ? q.status.join(',') : undefined,
  ownerId: q.ownerId,
  sort: q.sort,
  page: q.page,
  pageSize: q.pageSize,
});

const paginated = (d: ListResponse): Paginated<Auction> => ({
  items: d.auctions,
  page: d.page,
  pageSize: d.pageSize,
  total: d.total,
});

export interface CreateAuctionData {
  title: string;
  description: string;
  itemIds: string[];
  startingPriceCents: number;
  startsAt: string; // ISO com fuso
  durationSeconds: number;
}

export type UpdateAuctionData = Partial<Omit<CreateAuctionData, 'itemIds'>> & {
  itemIds?: string[];
  appendDescription?: string;
};

export const auctionService = {
  /** Listagem pública (RF20/RF21). Padrão: agendados + em andamento. */
  async list(query: ListQuery = {}) {
    const { data } = await api.get<ListResponse>('/auction/all', { params: toParams(query) });
    return paginated(data);
  },

  /** Leilões que eu criei. */
  async listOwn(query: Omit<ListQuery, 'ownerId'> = {}) {
    const { data } = await api.get<ListResponse>('/auction/my', { params: toParams(query) });
    return paginated(data);
  },

  /** Leilões que eu venci. */
  async listWon(query: Omit<ListQuery, 'ownerId'> = {}) {
    const { data } = await api.get<ListResponse>('/auction/history', { params: toParams(query) });
    return paginated(data);
  },

  async get(id: string) {
    const { data } = await api.get<{ auction: Auction }>(`/auction/${id}`);
    return data.auction;
  },

  async create(body: CreateAuctionData) {
    const { data } = await api.post<{ auction: Auction }>('/auction', body);
    return data.auction;
  },

  async update(id: string, body: UpdateAuctionData) {
    const { data } = await api.put<{ auction: Auction }>(`/auction/${id}`, body);
    return data.auction;
  },

  /** Não apaga: marca como Cancelado (RF08). */
  async cancel(id: string) {
    const { data } = await api.delete<{ auction: Auction }>(`/auction/${id}`);
    return data.auction;
  },
};
