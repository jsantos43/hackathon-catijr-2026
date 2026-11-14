import type { AuctionStatus, Category } from '../types';
import { serverNow } from './serverClock';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const NUM = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Dinheiro sempre em centavos inteiros. */
export const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? '—' : BRL.format(cents / 100);

/** "1.240,00" (sem o R$), para preencher inputs. */
export const moneyPlain = (cents: number) => NUM.format(cents / 100);

/** Aceita "1.240,00", "1240,5", "1240.50", "R$ 1.240". Devolve centavos ou NaN. */
export const parseMoney = (raw: string): number => {
  let s = raw.replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  const v = Number(s);
  return Number.isFinite(v) ? Math.round(v * 100) : NaN;
};

// Tabela de incrementos de referência (igual a api/src/utils/money.ts).
const INCREMENTS: [number, number][] = [
  [9_999, 100],
  [49_999, 500],
  [99_999, 1_000],
  [499_999, 5_000],
  [2_499_999, 10_000],
];

export const INCREMENT_TABLE: { range: string; inc: string }[] = [
  { range: 'até R$ 99,99', inc: 'R$ 1,00' },
  { range: 'R$ 100 a R$ 499,99', inc: 'R$ 5,00' },
  { range: 'R$ 500 a R$ 999,99', inc: 'R$ 10,00' },
  { range: 'R$ 1.000 a R$ 4.999,99', inc: 'R$ 50,00' },
  { range: 'R$ 5.000 a R$ 24.999,99', inc: 'R$ 100,00' },
  { range: 'a partir de R$ 25.000', inc: 'R$ 500,00' },
];

export const bidIncrementCents = (priceCents: number) =>
  INCREMENTS.find(([upTo]) => priceCents <= upTo)?.[1] ?? 50_000;

export const minimumBid = (a: {
  startingPriceCents: number;
  bidCount: number;
  finalPriceCents: number | null;
}) =>
  a.bidCount === 0 || a.finalPriceCents === null
    ? a.startingPriceCents
    : a.finalPriceCents + bidIncrementCents(a.finalPriceCents);

// ---------- Categorias / estados ----------

export const CATEGORY_LABEL: Record<Category, string> = {
  ELECTRONICS: 'Eletrônicos',
  FASHION: 'Moda',
  HOME: 'Casa',
  VEHICLES: 'Veículos',
  ART: 'Arte',
  COLLECTIBLES: 'Colecionáveis',
  SPORTS: 'Esporte',
  BOOKS: 'Livros',
  OTHER: 'Outros',
};
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];

export const STATUS_LABEL: Record<AuctionStatus, string> = {
  SCHEDULED: 'Agendado',
  RUNNING: 'Em andamento',
  SOLD: 'Vendido',
  ENDED_NO_BIDS: 'Encerrado sem lances',
  CANCELLED: 'Cancelado',
};

export const isOpen = (s: AuctionStatus) => s === 'SCHEDULED' || s === 'RUNNING';

// ---------- Datas ----------

const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const fullFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const monthYear = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });

export const hhmm = (iso: string | Date) => timeFmt.format(new Date(iso));
export const fullDate = (iso: string | Date) => fullFmt.format(new Date(iso));
export const sinceMonth = (iso: string) => monthYear.format(new Date(iso));
export const clockTime = (iso: string | Date) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const dayDiff = (d: Date) => {
  const a = new Date(serverNow());
  a.setHours(0, 0, 0, 0);
  const b = new Date(d);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
};

/** "hoje às 18:30", "amanhã às 10:00", "16/11 às 14:00". */
export const relativeDay = (iso: string | Date) => {
  const d = new Date(iso);
  const diff = dayDiff(d);
  const day = diff === 0 ? 'hoje' : diff === 1 ? 'amanhã' : diff === -1 ? 'ontem' : dateFmt.format(d);
  return `${day} às ${timeFmt.format(d)}`;
};

/** Badge curto: "Abre às 20:00", "Amanhã · 10:00", "16/11 · 14:00". */
export const shortWhen = (iso: string) => {
  const d = new Date(iso);
  const diff = dayDiff(d);
  if (diff === 0) return `Abre às ${timeFmt.format(d)}`;
  if (diff === 1) return `Amanhã · ${timeFmt.format(d)}`;
  return `${dateFmt.format(d)} · ${timeFmt.format(d)}`;
};

/** mm:ss ou hh:mm:ss ou "3d 04h". */
export const countdown = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${p(h)}h`;
  if (h > 0) return `${p(h)}:${p(m)}:${p(s)}`;
  return `${p(m)}:${p(s)}`;
};

export const durationLabel = (ms: number) => {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} minuto${min === 1 ? '' : 's'}`;
  const h = min / 60;
  if (h < 24) return `${Number.isInteger(h) ? h : h.toFixed(1)} hora${h === 1 ? '' : 's'}`;
  const d = h / 24;
  return `${Number.isInteger(d) ? d : d.toFixed(1)} dia${d === 1 ? '' : 's'}`;
};

/** Para <input type="datetime-local"> no fuso de quem vê. */
export const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const timezoneLabel = () => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const off = -new Date().getTimezoneOffset() / 60;
  const sign = off >= 0 ? '+' : '−';
  return `${tz.split('/').pop()?.replace(/_/g, ' ')} (UTC${sign}${Math.abs(off)})`;
};

// ---------- Pessoas (RF09) ----------

/** "Marina Torres" -> "Marina T." */
export const shortName = (name: string) => {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
};

export const initials = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};

const AVATAR_COLORS: [string, string][] = [
  ['#ECECFC', '#2F32B5'],
  ['#E3F4EC', '#0B5E40'],
  ['#FDECE3', '#9A3412'],
  ['#E8EEF8', '#2B4C7E'],
  ['#FFF4D6', '#6B4600'],
  ['#F3E8F7', '#6B2C80'],
  ['#EEEDE8', '#4A4D5A'],
];

/** Cor estável por hash do id. */
export const avatarColor = (id: string): [string, string] => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
};

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
