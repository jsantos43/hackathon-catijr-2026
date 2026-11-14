import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Dialog, ErrorState, Photo, Spinner, StatusBadge } from '../components/ui';
import { DURATIONS, LIMITS } from '../config';
import { useAuth } from '../contexts/AuthContext';
import { useNow } from '../hooks/useNow';
import { CATEGORY_LABEL, money, moneyPlain, parseMoney, plural, relativeDay, toLocalInput } from '../lib/format';
import { errorMessage } from '../services/api';
import { auctionService } from '../services/auctionService';
import type { Auction, AuctionStatus } from '../types';

type Tab = 'all' | 'SCHEDULED' | 'RUNNING' | 'SOLD' | 'closed';
const TABS: { id: Tab; label: string; status?: AuctionStatus[] }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'SCHEDULED', label: 'Agendados', status: ['SCHEDULED'] },
  { id: 'RUNNING', label: 'Em andamento', status: ['RUNNING'] },
  { id: 'SOLD', label: 'Vendidos', status: ['SOLD'] },
  { id: 'closed', label: 'Encerrados e cancelados', status: ['ENDED_NO_BIDS', 'CANCELLED'] },
];

type Action = { key: 'edit' | 'append' | 'cancel' | 'relist'; label: string; off: boolean; why?: string };

/** Matriz do RF23: o que pode em cada situação. */
function actionsFor(a: Auction, now: number): Action[] {
  const toStart = Date.parse(a.startsAt) - now;
  switch (a.status) {
    case 'SCHEDULED': {
      const locked = toStart <= LIMITS.EDIT_LOCK_MS;
      return [
        {
          key: 'edit',
          label: 'Editar',
          off: locked,
          why: locked ? 'Faltam 30 min ou menos para o início: não dá mais para editar.' : undefined,
        },
        { key: 'cancel', label: 'Cancelar', off: false },
      ];
    }
    case 'RUNNING':
      return [
        { key: 'append', label: 'Acrescentar texto', off: false },
        {
          key: 'cancel',
          label: 'Cancelar',
          off: a.bidCount > 0,
          why: a.bidCount > 0 ? 'Leilões com lances não podem ser cancelados.' : undefined,
        },
      ];
    case 'SOLD':
      return [{ key: 'relist', label: 'Relistar', off: true, why: 'Itens vendidos não podem ser relistados.' }];
    default:
      return [{ key: 'relist', label: 'Relistar', off: false }];
  }
}

export default function MeusLeiloes() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const now = useNow(15000);
  const [tab, setTab] = useState<Tab>('all');
  const [rows, setRows] = useState<Auction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<{ auction: Auction; mode: 'edit' | 'append' } | null>(null);
  const [cancelling, setCancelling] = useState<Auction | null>(null);

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(null);
    setError(null);
    auctionService
      .listOwn({ status: TABS.find((t) => t.id === tab)?.status, pageSize: 50 })
      .then((r) => active && setRows(r.items))
      .catch((e) => active && setError(errorMessage(e)));
    return () => {
      active = false;
    };
  }, [tab, retry]);

  const replace = (a: Auction) => setRows((r) => r?.map((x) => (x.id === a.id ? a : x)) ?? r);

  const runAction = (a: Auction, act: Action) => {
    if (act.off) return;
    if (act.key === 'edit' || act.key === 'append') setEditing({ auction: a, mode: act.key });
    if (act.key === 'cancel') setCancelling(a);
    if (act.key === 'relist') navigate(`/anunciar?relistar=${a.id}`);
  };

  return (
    <main className="page">
      <div className="row wrap between" style={{ alignItems: 'flex-end' }}>
        <div className="stack">
          <h1 className="page-title">Meus leilões</h1>
          <span className="muted">Quanto mais perto do início e quanto mais lances, menos dá para mudar.</span>
        </div>
        {user && <Link to={`/comitentes/${user.id}`}>Ver meu perfil público →</Link>}
      </div>

      <div className="segmented" role="group" aria-label="Filtrar por estado" style={{ alignSelf: 'flex-start' }}>
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => setRetry((r) => r + 1)} />
      ) : rows === null ? (
        <Spinner label="Carregando…" />
      ) : rows.length === 0 ? (
        <div className="empty">
          <span style={{ fontWeight: 600, fontSize: 18 }}>Nenhum leilão aqui</span>
          <span className="small muted">Anuncie um item e ele aparece nesta lista.</span>
          <Link to="/anunciar" className="btn btn-primary">
            Anunciar item
          </Link>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Estado</th>
                <th scope="col">Quando</th>
                <th scope="col">Valor</th>
                <th scope="col">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const cover = a.items[0];
                let when: string;
                if (a.status === 'SCHEDULED') when = `Abre ${relativeDay(a.startsAt)}`;
                else if (a.status === 'RUNNING') when = `Termina ${relativeDay(a.endsAt)}`;
                else when = `Encerrou ${relativeDay(a.endsAt)}`;
                const value =
                  a.status === 'SOLD' || (a.status === 'RUNNING' && a.bidCount > 0) ? a.finalPriceCents : a.startingPriceCents;
                const sub =
                  a.status === 'SOLD'
                    ? 'valor final'
                    : a.status === 'RUNNING'
                      ? plural(a.bidCount, 'lance', 'lances')
                      : 'preço inicial';
                return (
                  <tr key={a.id}>
                    <td>
                      <Link to={`/leiloes/${a.id}`} className="row" style={{ textDecoration: 'none', color: 'var(--ink)', minWidth: 220 }}>
                        <span className="thumb-sm">
                          <Photo src={cover?.images[0]} alt="" />
                        </span>
                        <span className="stack" style={{ gap: 0 }}>
                          <span style={{ fontWeight: 600 }}>{a.title}</span>
                          <span className="small muted">
                            {cover ? CATEGORY_LABEL[cover.category] : ''}
                            {a.items.length > 1 ? ` · ${a.items.length} itens` : ''}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={a.status} text={a.status === 'RUNNING' ? 'Em andamento' : undefined} />
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{when}</td>
                    <td>
                      <div className="stack" style={{ gap: 0 }}>
                        <span className="display num">{money(value)}</span>
                        <span className="small muted">{sub}</span>
                      </div>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        {actionsFor(a, now).map((act) => (
                          <button
                            key={act.key}
                            type="button"
                            className={`btn btn-sm ${act.key === 'cancel' ? 'btn-danger-outline' : 'btn-secondary'}`}
                            disabled={act.off}
                            title={act.why}
                            onClick={() => runAction(a, act)}
                          >
                            {act.label}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel" style={{ gap: 12 }}>
        <span style={{ fontWeight: 700 }}>Política de edição e cancelamento</span>
        <div style={{ overflowX: 'auto' }}>
          <table className="table-compact">
            <thead>
              <tr>
                <th scope="col">Situação</th>
                <th scope="col">Edição</th>
                <th scope="col">Cancelar</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Agendado, mais de 30 min antes</td><td>Todos os campos</td><td>Sim</td></tr>
              <tr><td>Agendado, 30 min ou menos</td><td>Nenhuma</td><td>Sim</td></tr>
              <tr><td>Em andamento, sem lances</td><td>Só acrescentar texto</td><td>Sim</td></tr>
              <tr><td>Em andamento, com lances</td><td>Só acrescentar texto</td><td>Não</td></tr>
              <tr><td>Vendido, Encerrado ou Cancelado</td><td>Nenhuma (relistar cria outro)</td><td>Não</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditDialog
          auction={editing.auction}
          mode={editing.mode}
          onClose={() => setEditing(null)}
          onSaved={(a) => {
            replace(a);
            setEditing(null);
          }}
        />
      )}
      {cancelling && (
        <CancelDialog
          auction={cancelling}
          onClose={() => setCancelling(null)}
          onDone={(a) => {
            replace(a);
            setCancelling(null);
          }}
        />
      )}
    </main>
  );
}

function CancelDialog({ auction, onClose, onDone }: { auction: Auction; onClose: () => void; onDone: (a: Auction) => void }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setSending(true);
    setError(null);
    try {
      onDone(await auctionService.cancel(auction.id));
    } catch (e) {
      setError(errorMessage(e));
      setSending(false);
    }
  };
  return (
    <Dialog title={`Cancelar "${auction.title}"?`} onClose={onClose}>
      <span className="muted">
        O leilão sai da listagem e fica registrado como Cancelado. Depois você pode relistar o item.
      </span>
      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Manter leilão
        </button>
        <button type="button" className="btn btn-danger" disabled={sending} onClick={confirm}>
          {sending && <span className="spinner" aria-hidden />}
          {sending ? 'Cancelando…' : 'Sim, cancelar'}
        </button>
      </div>
    </Dialog>
  );
}

function EditDialog({
  auction: a,
  mode,
  onClose,
  onSaved,
}: {
  auction: Auction;
  mode: 'edit' | 'append';
  onClose: () => void;
  onSaved: (a: Auction) => void;
}) {
  const originalDuration = Math.round((Date.parse(a.originalEndsAt) - Date.parse(a.startsAt)) / 1000);
  const [title, setTitle] = useState(a.title);
  const [description, setDescription] = useState(a.description);
  const [price, setPrice] = useState(moneyPlain(a.startingPriceCents));
  const [start, setStart] = useState(toLocalInput(new Date(a.startsAt)));
  const [duration, setDuration] = useState(originalDuration);
  const [append, setAppend] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const durations = DURATIONS.some((d) => d.seconds === originalDuration)
    ? DURATIONS
    : [{ label: 'Atual', seconds: originalDuration }, ...DURATIONS];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      if (mode === 'append') {
        onSaved(await auctionService.update(a.id, { appendDescription: append.trim() }));
        return;
      }
      const body: Parameters<typeof auctionService.update>[1] = {};
      if (title.trim() !== a.title) body.title = title.trim();
      if (description.trim() !== a.description) body.description = description.trim();
      const cents = parseMoney(price);
      if (Number.isNaN(cents)) throw new Error('Preço inválido.');
      if (cents !== a.startingPriceCents) body.startingPriceCents = cents;
      const startIso = new Date(start).toISOString();
      if (Date.parse(startIso) !== Date.parse(a.startsAt)) body.startsAt = startIso;
      if (duration !== originalDuration) body.durationSeconds = duration;
      if (Object.keys(body).length === 0) return onClose();
      onSaved(await auctionService.update(a.id, body));
    } catch (err) {
      setError(err instanceof Error && !('isAxiosError' in err) ? err.message : errorMessage(err));
      setSending(false);
    }
  }

  return (
    <Dialog title={mode === 'append' ? 'Acrescentar texto à descrição' : `Editar "${a.title}"`} onClose={onClose}>
      <form className="stack" style={{ gap: 14 }} onSubmit={submit}>
        {mode === 'append' ? (
          <>
            <span className="muted small">
              Com o leilão em andamento, o que já foi escrito não muda: o texto novo aparece como acréscimo.
            </span>
            <div className="field">
              <label htmlFor="ed-append">Texto a acrescentar</label>
              <textarea
                id="ed-append"
                className="textarea"
                maxLength={LIMITS.APPEND_DESCRIPTION_MAX}
                value={append}
                onChange={(e) => setAppend(e.target.value)}
              />
              <span className="counter">
                {append.length} / {LIMITS.APPEND_DESCRIPTION_MAX}
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="ed-title">Título</label>
              <input id="ed-title" className="input" maxLength={LIMITS.AUCTION_TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ed-desc">Descrição</label>
              <textarea id="ed-desc" className="textarea" maxLength={LIMITS.AUCTION_DESCRIPTION_MAX} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="grid-3">
              <div className="field">
                <label htmlFor="ed-price">Preço inicial</label>
                <div className="money-input">
                  <span>R$</span>
                  <input id="ed-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="ed-start">Início</label>
                <input id="ed-start" className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ed-dur">Duração</label>
                <select id="ed-dur" className="select" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                  {durations.map((d) => (
                    <option key={d.seconds} value={d.seconds}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <span className="small muted">
              Para trocar fotos ou dados do item, edite o item (só enquanto faltar mais de 30 min para o início).
            </span>
          </>
        )}
        {error && (
          <div className="alert alert-danger" role="alert">
            {error}
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Voltar
          </button>
          <button type="submit" className="btn btn-primary" disabled={sending || (mode === 'append' && !append.trim())}>
            {sending && <span className="spinner" aria-hidden />}
            {sending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
