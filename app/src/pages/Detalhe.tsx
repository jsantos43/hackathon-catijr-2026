import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Avatar, ErrorState, Gallery, PageLoader, StatusBadge } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useAsync } from '../hooks/useAsync';
import { useNow } from '../hooks/useNow';
import { LIMITS } from '../config';
import {
  CATEGORY_LABEL,
  countdown,
  durationLabel,
  hhmm,
  INCREMENT_TABLE,
  money,
  plural,
  relativeDay,
  shortName,
} from '../lib/format';
import { auctionService } from '../services/auctionService';

export default function Detalhe() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const now = useNow();
  const { data: a, error, loading, reload } = useAsync(() => auctionService.get(id), [id]);

  // Quando chega a hora de abrir/fechar, busca de novo para pegar o estado do servidor.
  const startsAt = a ? Date.parse(a.startsAt) : 0;
  const endsAt = a ? Date.parse(a.endsAt) : 0;
  const waitingOpen = a?.status === 'SCHEDULED' && now >= startsAt;
  const waitingClose = a?.status === 'RUNNING' && now >= endsAt;
  useEffect(() => {
    if (!waitingOpen && !waitingClose) return;
    const t = setTimeout(reload, 1500);
    return () => clearTimeout(t);
  }, [waitingOpen, waitingClose, reload, now]);

  if (loading && !a) return <PageLoader />;
  if (error || !a)
    return (
      <main className="page">
        <ErrorState message={error ?? 'Leilão não encontrado.'} onRetry={reload} />
      </main>
    );

  const images = a.items.flatMap((i) => i.images);
  const cover = a.items[0];
  const isOwner = user?.id === a.owner.id;
  const durationMs = Date.parse(a.originalEndsAt) - startsAt;
  const maxEnd = new Date(Date.parse(a.originalEndsAt) + LIMITS.EXTENSION_MAX_MS);

  // Separa o texto acrescentado depois (a API junta com "\n\n").
  const [baseDescription, ...appended] = a.description.split('\n\n');

  return (
    <main className="page">
      <nav aria-label="Caminho" className="small muted">
        <Link to="/">Leilões</Link>
        {cover && (
          <>
            {' / '}
            <Link to={`/?categoria=${cover.category}`}>{CATEGORY_LABEL[cover.category]}</Link>
          </>
        )}
        {' / '}
        {a.title}
      </nav>

      <div className="two-col">
        <div className="main">
          <Gallery images={images} alt={a.title} />
        </div>

        <aside className="side">
          <div className="panel">
            <div className="row wrap">
              <StatusBadge status={a.status} />
              {cover && <span className="eyebrow">{CATEGORY_LABEL[cover.category]}</span>}
            </div>
            <h1 style={{ fontSize: 30, lineHeight: '36px' }}>{a.title}</h1>
            <Link to={`/comitentes/${a.owner.id}`} className="row" style={{ textDecoration: 'none', color: 'var(--ink)' }}>
              <Avatar id={a.owner.id} name={a.owner.name} size={36} />
              <span>
                Anunciado por <b>{isOwner ? 'você' : a.owner.name}</b>
              </span>
            </Link>

            {a.status === 'SCHEDULED' && (
              <div className="clock">
                <div className="stack" style={{ gap: 0 }}>
                  <span className="small muted">Abre em</span>
                  <span className="small">{relativeDay(a.startsAt)} (seu horário)</span>
                </div>
                <span className="digits">{waitingOpen ? 'Abrindo…' : countdown(startsAt - now)}</span>
              </div>
            )}
            {a.status === 'RUNNING' && (
              <div className={`clock ${endsAt - now < LIMITS.EXTENSION_WINDOW_MS ? 'urgent' : ''}`}>
                <div className="stack" style={{ gap: 0 }}>
                  <span className="small">Termina em</span>
                  <span className="small">às {hhmm(a.endsAt)} (seu horário)</span>
                </div>
                <span className="digits">{waitingClose ? 'Aguardando servidor' : countdown(endsAt - now)}</span>
              </div>
            )}

            <dl className="dl">
              {a.status === 'SOLD' ? (
                <div>
                  <dt>Valor final</dt>
                  <dd>{money(a.finalPriceCents)}</dd>
                </div>
              ) : a.status === 'RUNNING' && a.bidCount > 0 ? (
                <div>
                  <dt>Preço atual</dt>
                  <dd>{money(a.finalPriceCents)}</dd>
                </div>
              ) : (
                <div>
                  <dt>Preço inicial</dt>
                  <dd>{money(a.startingPriceCents)}</dd>
                </div>
              )}
              <div>
                <dt>Duração</dt>
                <dd>{durationLabel(durationMs)}</dd>
              </div>
              <div>
                <dt>{a.status === 'SCHEDULED' || a.status === 'RUNNING' ? 'Término previsto' : 'Terminou'}</dt>
                <dd>{hhmm(a.endsAt)}</dd>
              </div>
              {(a.status === 'SCHEDULED' || a.status === 'RUNNING') && (
                <div>
                  <dt>Pode prorrogar até</dt>
                  <dd>{hhmm(maxEnd)}</dd>
                </div>
              )}
              {a.status !== 'SCHEDULED' && (
                <div>
                  <dt>Lances</dt>
                  <dd>{a.bidCount}</dd>
                </div>
              )}
            </dl>

            {a.status === 'SCHEDULED' && (
              <>
                <button type="button" className="btn btn-primary btn-block btn-bid" disabled>
                  A sala abre às {hhmm(a.startsAt)}
                </button>
                <span className="small muted">Quando abrir, você escolhe entrar como participante ou só assistir.</span>
              </>
            )}
            {a.status === 'RUNNING' && (
              <Link to={`/leiloes/${a.id}/sala`} className="btn btn-primary btn-block btn-bid">
                {user ? 'Entrar na sala' : 'Entrar para participar'}
              </Link>
            )}
            {a.status === 'SOLD' && (
              <div className="result-card" style={{ background: 'var(--win-tint)', color: 'var(--win-text)' }}>
                <span className="title">
                  {a.winnerId === user?.id ? 'Você venceu!' : a.winner ? `Vendido para ${shortName(a.winner.name)}` : 'Vendido'}
                </span>
                <span>
                  Valor final {money(a.finalPriceCents)} · {plural(a.bidCount, 'lance', 'lances')}
                </span>
              </div>
            )}
            {a.status === 'ENDED_NO_BIDS' && (
              <div className="result-card" style={{ background: 'var(--muted-bg)' }}>
                <span className="title">Encerrado sem lances</span>
                <span className="muted">Ninguém deu lance até o fim. O comitente pode relistar o item.</span>
              </div>
            )}
            {a.status === 'CANCELLED' && (
              <div className="result-card" style={{ border: '1px dashed var(--line-strong)' }}>
                <span className="title">Cancelado</span>
                <span className="muted">
                  {a.bidCount > 0
                    ? 'A disputa foi interrompida por uma falha do sistema e o leilão foi cancelado. Nenhum lance vale.'
                    : 'O comitente cancelou este leilão antes de qualquer lance.'}
                </span>
              </div>
            )}
            {isOwner && (
              <Link to="/meus-leiloes" className="btn btn-secondary btn-block">
                Gerenciar em Meus leilões
              </Link>
            )}
          </div>

          <div className="panel" style={{ gap: 12 }}>
            <span style={{ fontWeight: 700 }}>Como o lance mínimo cresce</span>
            <div style={{ overflowX: 'auto' }}>
              <table className="table-compact">
                <thead>
                  <tr>
                    <th scope="col">Preço atual</th>
                    <th scope="col">Incremento</th>
                  </tr>
                </thead>
                <tbody>
                  {INCREMENT_TABLE.map((r) => (
                    <tr key={r.range}>
                      <td>{r.range}</td>
                      <td className="num">{r.inc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <span className="small muted">
              O primeiro lance pode ser igual ao preço inicial. Um lance com menos de 2 min no relógio leva o término
              para 2 min depois dele, até 30 min a mais no total.
            </span>
          </div>
        </aside>
      </div>

      <section className="two-col">
        <div className="main panel">
          <h2 style={{ fontSize: 22 }}>Descrição</h2>
          <p className="description">{baseDescription || 'Sem descrição.'}</p>
          {appended.map((t, i) => (
            <div key={i} className="alert alert-info">
              <span>
                <b>Acréscimo:</b> {t}
              </span>
            </div>
          ))}
        </div>
        <div className="side panel">
          <h2 style={{ fontSize: 22 }}>{a.items.length > 1 ? `Itens do lote (${a.items.length})` : 'O item'}</h2>
          <div className="lot-items">
            {a.items.map((item) => (
              <div key={item.id} className="lot-item">
                <div className="thumb-sm">
                  {item.images[0] && <img className="img-fill" src={item.images[0]} alt="" />}
                </div>
                <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{item.name}</span>
                  <span className="eyebrow" style={{ fontSize: 11 }}>
                    {CATEGORY_LABEL[item.category]}
                  </span>
                  <span className="small muted description">{item.description}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
