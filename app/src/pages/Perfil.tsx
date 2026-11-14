import { Link, useParams } from 'react-router-dom';
import { Avatar, ErrorState, PageLoader, Photo, StatusBadge } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useAsync } from '../hooks/useAsync';
import { money, plural, relativeDay, sinceMonth } from '../lib/format';
import { auctionService } from '../services/auctionService';
import { userService } from '../services/userService';
import type { Auction } from '../types';

export default function Perfil() {
  const { id = '' } = useParams();
  const { user: me } = useAuth();

  const { data, error, loading, reload } = useAsync(async () => {
    const [user, running, scheduled, past] = await Promise.all([
      userService.getById(id),
      auctionService.list({ ownerId: id, status: ['RUNNING'], pageSize: 50 }),
      auctionService.list({ ownerId: id, status: ['SCHEDULED'], pageSize: 50 }),
      auctionService.list({ ownerId: id, status: ['SOLD', 'ENDED_NO_BIDS', 'CANCELLED'], pageSize: 12 }),
    ]);
    return { user, running, scheduled, past };
  }, [id]);

  if (loading && !data) return <PageLoader />;
  if (error || !data)
    return (
      <main className="page">
        <ErrorState message={error ?? 'Perfil não encontrado.'} onRetry={reload} />
      </main>
    );

  const { user, running, scheduled, past } = data;
  const groups: { title: string; items: Auction[] }[] = [
    { title: 'Em andamento', items: running.items },
    { title: 'Agendados', items: scheduled.items },
    { title: 'Passados', items: past.items },
  ];

  return (
    <main className="page">
      <section className="panel" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 20 }}>
        <Avatar id={user.id} name={user.name} size={72} />
        <div className="stack" style={{ gap: 2, flex: '1 1 240px' }}>
          <span className="eyebrow">Comitente{me?.id === user.id ? ' · você' : ''}</span>
          <h1 style={{ fontSize: 32 }}>{user.name}</h1>
          <span className="muted small">No Arremate desde {sinceMonth(user.createdAt)}</span>
        </div>
        <dl className="dl" style={{ flex: '1 1 320px' }}>
          <div>
            <dt>Em andamento</dt>
            <dd>{running.total}</dd>
          </div>
          <div>
            <dt>Agendados</dt>
            <dd>{scheduled.total}</dd>
          </div>
          <div>
            <dt>Passados</dt>
            <dd>{past.total}</dd>
          </div>
        </dl>
      </section>

      {groups.map((g) => (
        <section key={g.title} className="stack" style={{ gap: 12 }}>
          <h2 style={{ fontSize: 22 }}>{g.title}</h2>
          {g.items.length === 0 ? (
            <span className="muted small">Nenhum leilão.</span>
          ) : (
            <div className="auction-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
              {g.items.map((a) => (
                <Link
                  key={a.id}
                  to={a.status === 'RUNNING' ? `/leiloes/${a.id}/sala` : `/leiloes/${a.id}`}
                  className="card row"
                  style={{ padding: 12, textDecoration: 'none', color: 'var(--ink)', gap: 14 }}
                >
                  <span className="thumb-sm" style={{ width: 72, height: 72 }}>
                    <Photo src={a.items[0]?.images[0]} alt="" />
                  </span>
                  <span className="stack" style={{ gap: 4, minWidth: 0 }}>
                    <StatusBadge status={a.status} />
                    <span style={{ fontWeight: 600 }}>{a.title}</span>
                    <span className="small muted">
                      {a.status === 'SCHEDULED' && `Abre ${relativeDay(a.startsAt)} · ${money(a.startingPriceCents)}`}
                      {a.status === 'RUNNING' &&
                        `${money(a.bidCount ? a.finalPriceCents : a.startingPriceCents)} · ${plural(a.bidCount, 'lance', 'lances')}`}
                      {a.status === 'SOLD' && `Vendido por ${money(a.finalPriceCents)}`}
                      {a.status === 'ENDED_NO_BIDS' && `Sem lances · ${relativeDay(a.endsAt)}`}
                      {a.status === 'CANCELLED' && `Cancelado · ${relativeDay(a.endsAt)}`}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      ))}

      <span className="small muted">Perfis não têm avaliações nem reputação: só mostram quem anuncia e o que anunciou.</span>
    </main>
  );
}
