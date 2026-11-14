import { Link } from 'react-router-dom';
import { CATEGORY_LABEL, countdown, hhmm, money, plural, relativeDay, shortWhen } from '../lib/format';
import type { Auction } from '../types';
import { Photo, StatusBadge } from './ui';

interface Props {
  auction: Auction;
  now: number;
  logged: boolean;
}

export default function AuctionCard({ auction: a, now, logged }: Props) {
  const live = a.status === 'RUNNING';
  const cover = a.items[0];
  const extra = a.items.length > 1 ? ` + ${a.items.length - 1} ${a.items.length === 2 ? 'item' : 'itens'}` : '';
  const price = live && a.bidCount > 0 ? a.finalPriceCents : a.startingPriceCents;

  let badge: string;
  let when: string;
  let cta: string;
  if (live) {
    badge = `Ao vivo · ${countdown(new Date(a.endsAt).getTime() - now)}`;
    when = `Termina às ${hhmm(a.endsAt)}`;
    cta = logged ? 'Entrar na sala' : 'Entrar para participar';
  } else if (a.status === 'SCHEDULED') {
    badge = shortWhen(a.startsAt);
    when = `Abre ${relativeDay(a.startsAt)}`;
    cta = 'Ver detalhes';
  } else {
    badge = '';
    when = `Encerrou ${relativeDay(a.endsAt)}`;
    cta = 'Ver resultado';
  }

  return (
    <Link to={live ? `/leiloes/${a.id}/sala` : `/leiloes/${a.id}`} className="auction-card">
      <div className="photo">
        <Photo src={cover?.images[0]} alt={cover?.name ?? a.title} />
        <StatusBadge status={a.status} text={badge || undefined} />
      </div>
      <div className="body">
        <span className="eyebrow">
          {cover ? CATEGORY_LABEL[cover.category] : 'Lote'}
          {extra}
        </span>
        <span className="name">{a.title}</span>
        <div className="price-row">
          <div className="stack" style={{ gap: 2 }}>
            <span className="small muted">
              {live ? 'Preço atual' : a.status === 'SOLD' ? 'Valor final' : 'Preço inicial'}
            </span>
            <span className="price">{money(a.status === 'SOLD' ? a.finalPriceCents : price)}</span>
          </div>
          <span className="small muted" style={{ textAlign: 'right' }}>
            {a.status === 'SCHEDULED' ? 'Agendado' : plural(a.bidCount, 'lance', 'lances')}
          </span>
        </div>
      </div>
      <div className="foot">
        <span className="muted">{when}</span>
        <span className="cta">{cta}</span>
      </div>
    </Link>
  );
}
