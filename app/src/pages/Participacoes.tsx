import { Link } from 'react-router-dom';
import { ErrorState, Photo, Spinner, StatusBadge } from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { money, relativeDay } from '../lib/format';
import { bidService } from '../services/bidService';
import type { ParticipationSituation } from '../types';

const SITUATION: Record<ParticipationSituation, { label: string; cls: string }> = {
  LEADING: { label: 'Líder', cls: 'badge-leader' },
  OUTBID: { label: 'Superado', cls: 'badge-outbid' },
  WON: { label: 'Vencedor', cls: 'badge-winner' },
  LOST: { label: 'Não venceu', cls: 'badge-lost' },
};

export default function Participacoes() {
  const { data, error, loading, reload } = useAsync(() => bidService.participations(), []);
  const list = data ?? [];
  const count = (s: ParticipationSituation) => list.filter((p) => p.situation === s).length;

  return (
    <main className="page">
      <div className="stack">
        <h1 className="page-title">Minhas participações</h1>
        <span className="muted">Leilões em que você deu lances e como você está em cada um.</span>
      </div>

      <dl className="dl">
        <div>
          <dt>Liderando agora</dt>
          <dd style={{ fontSize: 24, color: 'var(--win)' }}>{count('LEADING')}</dd>
        </div>
        <div>
          <dt>Superado, ainda ao vivo</dt>
          <dd style={{ fontSize: 24, color: 'var(--live)' }}>{count('OUTBID')}</dd>
        </div>
        <div>
          <dt>Vencidos</dt>
          <dd style={{ fontSize: 24 }}>{count('WON')}</dd>
        </div>
        <div>
          <dt>Não vencidos</dt>
          <dd style={{ fontSize: 24 }}>{count('LOST')}</dd>
        </div>
      </dl>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading ? (
        <Spinner label="Carregando…" />
      ) : list.length === 0 ? (
        <div className="empty">
          <span style={{ fontWeight: 600, fontSize: 18 }}>Você ainda não participou de nenhum leilão</span>
          <span className="small muted">Entre numa sala ao vivo e dê seu primeiro lance.</span>
          <Link to="/?estado=live" className="btn btn-primary">
            Ver leilões ao vivo
          </Link>
        </div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {list.map(({ auction: a, myHighestBidCents, situation }) => {
            const live = a.status === 'RUNNING';
            const sit = SITUATION[situation];
            return (
              <div key={a.id} className="card row wrap" style={{ padding: 14, gap: 16 }}>
                <span className="thumb-sm" style={{ width: 64, height: 64 }}>
                  <Photo src={a.items[0]?.images[0]} alt="" />
                </span>
                <div className="stack" style={{ gap: 4, flex: '1 1 220px', minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{a.title}</span>
                  <span className="row small muted" style={{ gap: 8 }}>
                    <StatusBadge status={a.status} />
                    {live ? `Termina ${relativeDay(a.endsAt)}` : `Encerrou ${relativeDay(a.endsAt)}`}
                  </span>
                </div>
                <div className="stack" style={{ gap: 0 }}>
                  <span className="small muted">Seu maior lance</span>
                  <span className="display num">{money(myHighestBidCents)}</span>
                </div>
                <div className="stack" style={{ gap: 0 }}>
                  <span className="small muted">{live ? 'Preço atual' : 'Valor final'}</span>
                  <span className="display num">{money(a.finalPriceCents)}</span>
                </div>
                <span className={`badge ${sit.cls}`}>{sit.label}</span>
                <Link
                  to={live ? `/leiloes/${a.id}/sala` : `/leiloes/${a.id}`}
                  className={`btn btn-sm ${situation === 'OUTBID' ? 'btn-primary' : 'btn-secondary'}`}
                >
                  {situation === 'OUTBID' ? 'Dar novo lance' : live ? 'Voltar à sala' : 'Ver leilão'}
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
