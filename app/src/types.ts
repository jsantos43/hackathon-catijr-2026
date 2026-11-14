// Tipos espelhando as respostas da API (api/src/services/*). Datas chegam como string ISO.

export type AuctionStatus = 'SCHEDULED' | 'RUNNING' | 'SOLD' | 'ENDED_NO_BIDS' | 'CANCELLED';

export type Category =
  | 'ELECTRONICS'
  | 'FASHION'
  | 'HOME'
  | 'VEHICLES'
  | 'ART'
  | 'COLLECTIBLES'
  | 'SPORTS'
  | 'BOOKS'
  | 'OTHER';

export interface User {
  id: string;
  name: string;
  email?: string;
  createdAt?: string;
}

export interface PublicUser {
  id: string;
  name: string;
  createdAt: string;
}

export interface Item {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  category: Category;
  images: string[];
  createdAt: string;
  updatedAt: string;
}

/** GET /item devolve também os leilões de que o item participou. */
export interface OwnItem extends Item {
  auctions: {
    id: string;
    title: string;
    status: AuctionStatus;
    startsAt: string;
    endsAt: string;
    finalPriceCents: number | null;
  }[];
}

export interface Auction {
  id: string;
  title: string;
  description: string;
  status: AuctionStatus;
  startingPriceCents: number;
  bidCount: number;
  startsAt: string;
  originalEndsAt: string;
  endsAt: string;
  /** Em andamento: líder atual. Depois: vencedor (ou null). */
  winnerId: string | null;
  /** Em andamento: preço atual. Depois: valor pago (ou null). */
  finalPriceCents: number | null;
  minimumBidCents: number | null;
  createdAt: string;
  updatedAt: string;
  items: Item[];
  owner: PublicUser;
}

export interface Paginated<T> {
  page: number;
  pageSize: number;
  total: number;
  items: T[];
}

export interface Bid {
  id: string;
  auctionId: string;
  bidderId: string;
  bidderName: string;
  amountCents: number;
  createdAt: string;
}

export type ParticipationSituation = 'LEADING' | 'OUTBID' | 'WON' | 'LOST';

export interface Participation {
  auction: Auction;
  myHighestBidCents: number;
  situation: ParticipationSituation;
}

export interface ApiErrorBody {
  success: false;
  error: string;
  message: string;
  details: string[];
}
