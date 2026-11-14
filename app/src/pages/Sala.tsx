import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Info, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Avatar, ErrorState, Gallery, Logo, PageLoader, StatusBadge } from '../components/ui';
import { LIMITS } from '../config';
import { useAuth } from '../contexts/AuthContext';
import { useNow } from '../hooks/useNow';
import {
  bidIncrementCents,
  CATEGORY_LABEL,
  clockTime,
  countdown,
  hhmm,
  initials,
  minimumBid,
  money,
  moneyPlain,
  parseMoney,
  plural,
  shortName,
  uuid,
} from '../lib/format';
import { errorMessage } from '../services/api';
import { auctionService } from '../services/auctionService';
import { bidService } from '../services/bidService';
import {
  getSocket,
  joinAuction,
  placeBid,
  setRole,
  type BidEvent,
  type PresenceEvent,
  type Role,
  type StatusEvent,
} from '../services/socket';
import type { Auction, Bid } from '../types';

type Conn = 'connecting' | 'ok' | 'retry' | 'off';
type Toast = { kind: 'ok' | 'out' | 'ext'; title: string; text: string };

const REJECT_TEXT: Record<string, string> = {
  BID_TOO_LOW: 'Outro lance chegou antes do seu.',
  AUCTION_NOT_RUNNING: 'O leilão não está mais aberto a lances.',
  IS_OWNER: 'Você não pode dar lance no próprio leilão.',
  ALREADY_LEADER: 'Você já é o líder deste leilão.',
  RATE_LIMITED: 'Aguarde um instante entre um lance e outro.',
  UNAUTHORIZED: 'Sua sessão expirou. Entre de novo para dar lances.',
  NOT_IN_ROOM: 'Você saiu da sala. Aguarde a reconexão.',
  DISCONNECTED: 'Sem conexão com a sala.',
};

export default function Sala() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const now = useNow(500);

  const [auction, setAuction] = useState<Auction | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conn, setConn] = useState<Conn>('connecting');
  const [presence, setPresence] = useState<PresenceEvent | null>(null);
  const [role, setRoleState] = useState<Role>('participant');
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  // Refs para os handlers do socket enxergarem o estado atual.
  const auctionRef = useRef<Auction | null>(null);
  const userRef = useRef(user);
  const roleRef = useRef<Role>(role);
  useLayoutEffect(() => {
    auctionRef.current = auction;
    userRef.current = user;
    roleRef.current = role;
  }, [auction, user, role]);

  const refresh = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([auctionService.get(id), bidService.list(id)]);
      setAuction(a);
      setBids((prev) => {
        // Mantém lances recebidos pelo socket que ainda não vieram na resposta.
        const ids = new Set(b.map((x) => x.id));
        return [...b, ...prev.filter((x) => !ids.has(x.id))].sort(
          (x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt),
        );
      });
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [id]);

  /** Aplica um lance aceito (evento da sala ou ack do próprio lance). */
  const applyBid = useCallback((evt: BidEvent) => {
    const me = userRef.current;
    const prev = auctionRef.current;
    setBids((list) => (list.some((b) => b.id === evt.bid.id) ? list : [evt.bid, ...list]));
    setAuction((a) =>
      a
        ? {
            ...a,
            finalPriceCents: evt.priceCents,
            winnerId: evt.leaderId,
            winner: { id: evt.leaderId, name: evt.bid.bidderName, createdAt: a.winner?.createdAt ?? '' },
            bidCount: evt.bidCount,
            endsAt: evt.endsAt,
            minimumBidCents: evt.minimumBidCents,
          }
        : a,
    );
    if (!me) return;
    if (evt.leaderId !== me.id && prev?.winnerId === me.id) {
      // RF26: avisa na hora quem foi superado.
      setToast({
        kind: 'out',
        title: 'Seu lance foi superado',
        text: `${shortName(evt.bid.bidderName)} ofereceu ${money(evt.priceCents)}. Mínimo agora: ${money(evt.minimumBidCents)}.`,
      });
    } else if (evt.extended && evt.leaderId !== me.id) {
      setToast({ kind: 'ext', title: 'Leilão prorrogado', text: `Novo término às ${hhmm(evt.endsAt)}.` });
    }
  }, []);

  // Carga inicial.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  // Socket: entra na sala, ouve os eventos e reentra ao reconectar (RF24).
  useEffect(() => {
    const s = getSocket();
    let failures = 0;

    const onConnect = async () => {
      failures = 0;
      setConn('ok');
      try {
        // Entra (ou reentra, depois de reconectar) com o papel que a pessoa escolheu.
        const ack = await joinAuction(s, id, roleRef.current);
        if (ack.ok) {
          setAuction(ack.snapshot.auction);
          setBids(ack.snapshot.bids);
          setPresence(ack.snapshot.presence);
          setLoadError(null);
        } else if (ack.error === 'NOT_FOUND') {
          setLoadError('Leilão não encontrado.');
        } else {
          await refresh();
        }
      } catch {
        setConn('retry');
      }
    };
    const onDisconnect = () => setConn('retry');
    const onError = () => {
      failures += 1;
      setConn(failures > 5 ? 'off' : 'retry');
    };
    const onStatus = (e: StatusEvent) => {
      if (e.auctionId !== id) return;
      setAuction((a) =>
        a ? { ...a, status: e.status, endsAt: e.endsAt, winnerId: e.winnerId, finalPriceCents: e.finalPriceCents } : a,
      );
      // Abriu, vendeu, encerrou ou cancelou: busca o estado completo (vencedor, mínimo...).
      void refresh();
    };
    const onBid = (e: BidEvent) => e.auctionId === id && applyBid(e);
    const onPresence = (e: PresenceEvent) => e.auctionId === id && setPresence(e);

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onError);
    s.on('auction:status', onStatus);
    s.on('auction:bid', onBid);
    s.on('auction:presence', onPresence);

    if (s.connected) void onConnect();
    else s.connect();

    return () => {
      s.emit('auction:leave', { auctionId: id });
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('connect_error', onError);
      s.off('auction:status', onStatus);
      s.off('auction:bid', onBid);
      s.off('auction:presence', onPresence);
    };
  }, [id, refresh, applyBid]);

  const status = auction?.status;
  const running = status === 'RUNNING';
  const endsAtMs = auction ? Date.parse(auction.endsAt) : 0;
  const startsAtMs = auction ? Date.parse(auction.startsAt) : 0;
  const remaining = endsAtMs - now;
  const timeUp = running && remaining <= 0;

  // Se o relógio zerou e o servidor ainda não avisou, confere pela API (o socket pode ter caído).
  const overdue = (running && remaining < -3000) || (status === 'SCHEDULED' && now - startsAtMs > 3000);
  useEffect(() => {
    if (!overdue) return;
    const t = setTimeout(() => void refresh(), 2000);
    return () => clearTimeout(t);
  }, [overdue, refresh, now]);

  const min = auction ? (auction.minimumBidCents ?? minimumBid(auction)) : 0;
  const price = auction ? (auction.bidCount > 0 ? auction.finalPriceCents : auction.startingPriceCents) : null;
  const isOwner = !!user && auction?.owner.id === user.id;
  const youLead = !!user && auction?.winnerId === user.id && (auction?.bidCount ?? 0) > 0;

  // Mantém o campo pelo menos no mínimo vigente.
  useEffect(() => {
    if (!min || sending) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAmount((cur) => {
      const v = parseMoney(cur);
      return Number.isNaN(v) || v < min ? moneyPlain(min) : cur;
    });
  }, [min, sending]);

  // Avisos de sucesso somem sozinhos.
  useEffect(() => {
    if (!toast || toast.kind === 'out') return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const leaderName = useMemo(() => {
    if (!auction || auction.bidCount === 0 || !auction.winnerId) return '—';
    if (auction.winnerId === user?.id) return 'Você';
    if (auction.winner?.id === auction.winnerId) return shortName(auction.winner.name);
    const b = bids.find((x) => x.bidderId === auction.winnerId);
    return b ? shortName(b.bidderName) : 'Outro participante';
  }, [auction, bids, user]);

  const changeRole = (r: Role) => {
    setRoleState(r);
    setMsg(null);
    // Se falhar (sem conexão), o papel é reenviado no próximo auction:join.
    setRole(getSocket(), id, r).catch(() => undefined);
  };

  async function handleBid(e: FormEvent) {
    e.preventDefault();
    if (!auction || !user || sending) return;
    const value = parseMoney(amount);
    if (youLead) return setMsg(REJECT_TEXT.ALREADY_LEADER);
    if (Number.isNaN(value) || value < min) {
      return setMsg(`Valor abaixo do lance mínimo atual. O mínimo agora é ${money(min)}.`);
    }

    setSending(true);
    setMsg(null);
    setToast(null);
    // Uma chave por tentativa: se a conexão cair e o lance for reenviado, não duplica (RF12).
    const idempotencyKey = uuid();
    try {
      const ack = await placeBid(getSocket(), { auctionId: auction.id, amountCents: value, idempotencyKey });
      if (ack.ok) {
        const evt: BidEvent = {
          auctionId: auction.id,
          bid: ack.bid,
          priceCents: ack.auction.finalPriceCents,
          minimumBidCents: ack.auction.minimumBidCents,
          leaderId: ack.auction.winnerId,
          bidCount: ack.auction.bidCount,
          endsAt: ack.auction.endsAt,
          extended: ack.extended,
          serverTime: new Date().toISOString(),
        };
        applyBid(evt);
        setAmount(moneyPlain(evt.minimumBidCents));
        setToast({
          kind: 'ok',
          title: `Lance aceito: ${money(ack.bid.amountCents)}`,
          text: evt.extended ? 'Você é o líder. O término foi prorrogado.' : 'Você é o líder agora.',
        });
      } else {
        const currentMin = ack.minimumBidCents ?? min;
        const reason = REJECT_TEXT[ack.error] ?? ack.message ?? 'Lance recusado.';
        setMsg(`${reason} O lance mínimo agora é ${money(currentMin)}.`);
        const serverMin = ack.minimumBidCents;
        if (serverMin) setAuction((a) => (a ? { ...a, minimumBidCents: serverMin } : a));
      }
    } catch (err) {
      setMsg(`${errorMessage(err, 'O servidor não respondeu.')} O lance mínimo agora é ${money(min)}.`);
    } finally {
      setSending(false);
    }
  }

  if (!auction && !loadError) return <PageLoader />;
  if (!auction)
    return (
      <main className="page">
        <ErrorState message={loadError ?? 'Leilão não encontrado.'} onRetry={() => void refresh()} />
      </main>
    );

  const cover = auction.items[0];
  const images = auction.items.flatMap((i) => i.images);
  const urgent = running && remaining < LIMITS.EXTENSION_WINDOW_MS && remaining > 0;
  const extendedMs = Date.parse(auction.endsAt) - Date.parse(auction.originalEndsAt);
  const offline = conn !== 'ok';
  const inc = bidIncrementCents(price ?? min);
  const quick = [
    { label: 'Mínimo', v: min },
    { label: `+${money(inc)}`, v: min + inc },
    { label: `+${money(4 * inc)}`, v: min + 4 * inc },
  ];
  const bidDisabled = sending || youLead || offline || timeUp;
  let btnText = `Dar lance · R$ ${amount || moneyPlain(min)}`;
  if (sending) btnText = 'Enviando lance…';
  else if (youLead) btnText = 'Você é o líder';
  else if (offline) btnText = 'Aguardando conexão…';
  else if (timeUp) btnText = 'Aguardando servidor';

  const stateLabel = running ? 'Ao vivo' : undefined;

  return (
    <>
      <header className="site-header">
        <div className="container">
          <Logo />
          <Link to="/" className="row small" style={{ gap: 6, flex: 1, textDecoration: 'none', fontWeight: 600 }}>
            <ArrowLeft size={16} aria-hidden /> Voltar aos leilões
          </Link>
          <span className={`conn ${conn === 'ok' ? 'ok' : conn === 'off' ? 'off' : 'retry'}`} role="status">
            <span className="dot" aria-hidden />
            {conn === 'ok' ? 'Conectado · tempo real' : conn === 'off' ? 'Sem conexão' : 'Reconectando…'}
          </span>
          {user && (
            <span
              className="avatar"
              aria-label={`Sua conta: ${shortName(user.name)}`}
              style={{ background: 'var(--primary-tint)', color: 'var(--primary-hover)' }}
            >
              {initials(user.name)}
            </span>
          )}
        </div>
      </header>

      {(conn === 'retry' || conn === 'off') && (
        <div className="banner" role="status">
          <div className="container">
            <span className="spinner" aria-hidden />
            <span>
              <b>Conexão perdida. Reconectando…</b> Seu lugar na sala está guardado; ao voltar, você vê o estado
              atualizado.
            </span>
          </div>
        </div>
      )}

      <main className="page">
        <div className="two-col">
          <section className="main">
            <Gallery images={images} alt={auction.title} badge={<StatusBadge status={auction.status} text={stateLabel} />} />
            <div className="stack">
              {cover && <span className="eyebrow">{CATEGORY_LABEL[cover.category]}</span>}
              <h1 style={{ fontSize: 30, lineHeight: '36px' }}>{auction.title}</h1>
              <span className="muted">
                Anunciado por <Link to={`/comitentes/${auction.owner.id}`}>{isOwner ? 'você' : auction.owner.name}</Link> ·
                preço inicial {money(auction.startingPriceCents)} ·{' '}
                <Link to={`/leiloes/${auction.id}`}>ver descrição completa</Link>
              </span>
            </div>

            <div className="panel" style={{ gap: 4 }}>
              <div className="row between" style={{ marginBottom: 8 }}>
                <h2 style={{ fontSize: 20 }}>Últimos lances</h2>
                <span className="small muted">{plural(auction.bidCount, 'lance no total', 'lances no total')}</span>
              </div>
              {bids.length === 0 && (
                <span className="muted small" style={{ padding: '8px 0' }}>
                  {auction.bidCount === 0
                    ? 'Nenhum lance foi dado neste leilão.'
                    : 'Os próximos lances aparecem aqui em tempo real.'}
                </span>
              )}
              <div aria-live="polite">
                {bids.slice(0, 8).map((b, i) => {
                  const mine = b.bidderId === user?.id;
                  return (
                    <div key={b.id} className={`bid-row ${i === 0 ? 'top' : ''}`}>
                      <Avatar id={b.bidderId} name={b.bidderName} self={mine} size={36} />
                      <div className="stack" style={{ gap: 0 }}>
                        <span style={{ fontWeight: mine ? 700 : 500 }}>{mine ? 'Você' : shortName(b.bidderName)}</span>
                        <span className="small muted num">{clockTime(b.createdAt)}</span>
                      </div>
                      {i === 0 && <span className="badge badge-leader">Maior lance</span>}
                      <span className="amt">{money(b.amountCents)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <aside className="side" aria-label="Painel do leilão">
            {toast && (
              <div
                className={`alert ${toast.kind === 'ok' ? 'alert-success' : toast.kind === 'out' ? 'alert-live' : 'alert-warn'}`}
                role="alert"
              >
                {toast.kind === 'ok' ? <CheckCircle2 size={20} aria-hidden /> : toast.kind === 'out' ? <AlertTriangle size={20} aria-hidden /> : <Clock size={20} aria-hidden />}
                <div>
                  <span className="title">{toast.title}</span>
                  <span>{toast.text}</span>
                </div>
                <button type="button" className="close" aria-label="Fechar aviso" onClick={() => setToast(null)}>
                  <X size={18} aria-hidden />
                </button>
              </div>
            )}

            <div className="panel">
              <div className="row between wrap">
                <StatusBadge status={auction.status} text={stateLabel} />
                {presence && (
                  <span className="small muted">
                    {plural(presence.participants, 'participante', 'participantes')} ·{' '}
                    {plural(presence.spectators, 'espectador', 'espectadores')}
                  </span>
                )}
              </div>

              {running && (
                <div className={`clock ${urgent ? 'urgent' : ''}`}>
                  <div className="stack" style={{ gap: 0 }}>
                    <span className="small" style={{ fontWeight: 600 }}>
                      {urgent ? 'Últimos minutos' : 'Termina em'}
                    </span>
                    <span className="small">
                      {urgent ? 'Lances agora prorrogam o término' : `às ${hhmm(auction.endsAt)} (seu horário)`}
                    </span>
                  </div>
                  <span className="digits" aria-live="off">
                    {timeUp ? 'Aguardando servidor' : countdown(remaining)}
                  </span>
                </div>
              )}

              {auction.status === 'SCHEDULED' && (
                <div className="clock">
                  <div className="stack" style={{ gap: 0 }}>
                    <span className="small" style={{ fontWeight: 600 }}>
                      A sala abre em
                    </span>
                    <span className="small">às {hhmm(auction.startsAt)} (seu horário)</span>
                  </div>
                  <span className="digits">{now >= startsAtMs ? 'Abrindo…' : countdown(startsAtMs - now)}</span>
                </div>
              )}

              {running && extendedMs > 0 && (
                <div className="alert alert-warn">
                  <Clock size={18} aria-hidden />
                  <span>
                    <b>Prorrogado.</b> Lance nos minutos finais. Prorrogação acumulada: {Math.round(extendedMs / 60000)}{' '}
                    de 30 min.
                  </span>
                </div>
              )}

              <div className="stack" style={{ gap: 2 }}>
                <span className="small muted">
                  {running ? 'Preço atual' : auction.status === 'SOLD' ? 'Valor final' : 'Preço inicial'}
                </span>
                <span className="big-price">{money(auction.status === 'SOLD' ? auction.finalPriceCents : price)}</span>
              </div>

              <dl className="dl">
                <div>
                  <dt>Lance mínimo</dt>
                  <dd>{running || auction.status === 'SCHEDULED' ? money(min) : '—'}</dd>
                </div>
                <div>
                  <dt>Líder</dt>
                  <dd style={{ color: youLead ? 'var(--win)' : undefined }}>{leaderName}</dd>
                </div>
                <div>
                  <dt>Lances</dt>
                  <dd>{auction.bidCount}</dd>
                </div>
              </dl>

              {msg && running && !isOwner && role === 'participant' && (
                <div className="alert alert-danger" role="alert">
                  <AlertTriangle size={18} aria-hidden />
                  <div>
                    <span className="title">Lance recusado</span>
                    <span>{msg}</span>
                  </div>
                </div>
              )}

              {running && isOwner && (
                <div className="alert alert-info">
                  <Info size={18} aria-hidden />
                  <span>
                    <b>Este leilão é seu.</b> Você acompanha como espectador; comitentes não dão lances no próprio
                    leilão.
                  </span>
                </div>
              )}

              {running && !isOwner && role === 'participant' && (
                <form className="stack" style={{ gap: 12 }} onSubmit={handleBid}>
                  <label htmlFor="sala-valor" className="label">
                    Seu lance
                  </label>
                  <div className="money-input" style={{ height: 52, borderColor: msg ? 'var(--danger)' : 'var(--primary)' }}>
                    <span>R$</span>
                    <input
                      id="sala-valor"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={amount}
                      disabled={youLead}
                      style={{ fontSize: 20, fontWeight: 700 }}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setMsg(null);
                      }}
                    />
                  </div>
                  <div className="row wrap" style={{ gap: 8 }}>
                    {quick.map((q) => (
                      <button
                        key={q.label}
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ flex: 1 }}
                        disabled={youLead}
                        onClick={() => {
                          setAmount(moneyPlain(q.v));
                          setMsg(null);
                        }}
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                  <button type="submit" className="btn btn-primary btn-block btn-bid" disabled={bidDisabled}>
                    {sending && <span className="spinner" aria-hidden />}
                    {btnText}
                  </button>
                  <div className="row between small">
                    <span className="muted">O lance é irrevogável.</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => changeRole('spectator')}>
                      Só assistir
                    </button>
                  </div>
                </form>
              )}

              {running && !isOwner && role === 'spectator' && (
                <div className="alert alert-muted" style={{ flexDirection: 'column', gap: 8 }}>
                  <span className="title" style={{ color: 'var(--ink)' }}>
                    Você está assistindo
                  </span>
                  <span>Acompanhe a disputa sem dar lances. Para participar, não precisa sair da sala.</span>
                  <button type="button" className="btn btn-primary" onClick={() => changeRole('participant')}>
                    Participar da disputa
                  </button>
                </div>
              )}

              {auction.status === 'SOLD' &&
                (auction.winnerId === user?.id ? (
                  <div className="result-card" style={{ background: 'var(--win)', color: '#fff' }}>
                    <span className="small" style={{ fontWeight: 700, opacity: 0.85 }}>
                      Resultado
                    </span>
                    <span className="title">Você venceu!</span>
                    <span>Arrematado por {money(auction.finalPriceCents)}. A compra já conta no seu histórico.</span>
                  </div>
                ) : (
                  <div className="result-card" style={{ background: 'var(--win-tint)', color: 'var(--win-text)' }}>
                    <span className="small" style={{ fontWeight: 700 }}>
                      Resultado
                    </span>
                    <span className="title">Vendido para {leaderName}</span>
                    <span>
                      Valor final: {money(auction.finalPriceCents)} · {plural(auction.bidCount, 'lance', 'lances')}.
                    </span>
                  </div>
                ))}
              {auction.status === 'ENDED_NO_BIDS' && (
                <div className="result-card" style={{ background: 'var(--muted-bg)' }}>
                  <span className="small muted" style={{ fontWeight: 700 }}>
                    Resultado
                  </span>
                  <span className="title">Encerrado sem lances</span>
                  <span className="muted">Ninguém deu lance até o fim. O comitente pode relistar o item.</span>
                </div>
              )}
              {auction.status === 'CANCELLED' && (
                <div className="result-card" style={{ border: '1px dashed var(--line-strong)' }}>
                  <span className="title">Leilão cancelado</span>
                  <span className="muted">Este leilão foi cancelado e não aceita mais lances.</span>
                </div>
              )}
            </div>

            <div className="alert alert-muted small">
              <Info size={16} aria-hidden style={{ flex: 'none', marginTop: 2 }} />
              <span>
                O horário que vale é o do servidor. Lances com menos de 2 min no relógio levam o término para 2 min
                depois, até 30 min a mais.
              </span>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
