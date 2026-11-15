import { ArrowDown, ArrowLeft, ArrowUp } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Check3, Dialog, ErrorState, Photo, Spinner } from '../components/ui';
import { DURATIONS, LIMITS } from '../config';
import { isAvailable, itemsQuery, parseItemIds } from '../lib/inventory';
import { CATEGORY_LABEL, hhmm, money, moneyPlain, parseMoney, relativeDay, toLocalInput } from '../lib/format';
import { serverNow } from '../lib/serverClock';
import { errorMessage } from '../services/api';
import { auctionService } from '../services/auctionService';
import { itemService } from '../services/itemService';
import type { OwnItem } from '../types';

const defaultStart = () => {
  const d = new Date(serverNow() + 5 * 60 * 1000);
  d.setSeconds(0, 0);
  return toLocalInput(d);
};

/**
 * Passo 2 do anúncio: define o leilão para os itens escolhidos no inventário
 * (`?itens=a,b`) ou relista um leilão encerrado (`?relistar=:id`, RF28).
 */
export default function Criar() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const relistId = params.get('relistar');
  const queryIds = useMemo(() => parseItemIds(params.get('itens')), [params]);

  const [itemIds, setItemIds] = useState<string[]>(queryIds);
  const [ownItems, setOwnItems] = useState<OwnItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [auctionDescription, setAuctionDescription] = useState('');
  const [price, setPrice] = useState('');
  const [start, setStart] = useState(defaultStart);
  const [duration, setDuration] = useState(30 * 60);

  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    itemService
      .listOwn()
      .then(setOwnItems)
      .catch((e) => setLoadError(errorMessage(e)));
  }, []);

  // Relistar (RF28): parte dos dados do leilão antigo.
  useEffect(() => {
    if (!relistId) return;
    auctionService
      .get(relistId)
      .then((a) => {
        setItemIds(a.items.map((i) => i.id));
        setTitle(a.title);
        setAuctionDescription(a.description);
        setPrice(moneyPlain(a.startingPriceCents));
        const dur = Math.round((Date.parse(a.originalEndsAt) - Date.parse(a.startsAt)) / 1000);
        if (DURATIONS.some((d) => d.seconds === dur)) setDuration(dur);
      })
      .catch((e) => setLoadError(errorMessage(e)));
  }, [relistId]);

  // Itens do lote, na ordem escolhida (o primeiro é a capa).
  const items = useMemo(
    () => itemIds.map((id) => ownItems?.find((i) => i.id === id)).filter((i): i is OwnItem => !!i),
    [itemIds, ownItems],
  );
  const blocked = items.filter((i) => !isAvailable(i));

  /** Reordena o lote (o primeiro item é a capa do leilão). */
  const moveItem = (from: number, to: number) =>
    setItemIds(() => {
      const ids = items.map((i) => i.id);
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved!);
      return ids;
    });
  const single = items.length === 1 ? items[0] : null;

  const priceCents = parseMoney(price);
  const startDate = new Date(start);
  const leadMs = startDate.getTime() - serverNow();
  const endDate = new Date(startDate.getTime() + duration * 1000);
  const effectiveTitle = (title.trim() || single?.name || '').slice(0, LIMITS.AUCTION_TITLE_MAX);

  const checks = {
    items: items.length > 0 && blocked.length === 0,
    title: effectiveTitle.length >= 3,
    auction:
      !Number.isNaN(priceCents) &&
      priceCents >= LIMITS.MIN_PRICE_CENTS &&
      !Number.isNaN(startDate.getTime()) &&
      leadMs >= LIMITS.START_MIN_LEAD_MS &&
      leadMs <= LIMITS.START_MAX_LEAD_MS,
  };
  const ready = checks.items && checks.title && checks.auction;

  // Sem itens escolhidos: volta para o inventário.
  if (!relistId && queryIds.length === 0) return <Navigate to="/anunciar" replace />;

  // "Publicar leilão" só abre a confirmação; quem publica é o botão do diálogo.
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ready || sending) return;
    setConfirming(true);
  }

  async function publish() {
    if (!ready || sending) return;
    setConfirming(false);
    setSending(true);
    setError(null);
    try {
      const auction = await auctionService.create({
        title: effectiveTitle,
        description: auctionDescription.trim() || single?.description || '',
        itemIds: items.map((i) => i.id),
        startingPriceCents: priceCents,
        startsAt: startDate.toISOString(),
        durationSeconds: duration,
      });
      navigate(`/leiloes/${auction.id}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível publicar o leilão.'));
      setSending(false);
    }
  }

  const changeLink = `/anunciar?${itemsQuery(items.map((i) => i.id))}`;
  const loading = ownItems === null || (relistId !== null && itemIds.length === 0);

  return (
    <main className="page">
      <div className="stack">
        <Link
          to={relistId ? '/meus-leiloes' : changeLink}
          className="row small"
          style={{ gap: 6, textDecoration: 'none', fontWeight: 600 }}
        >
          <ArrowLeft size={16} aria-hidden /> {relistId ? 'Meus leilões' : 'Meu inventário'}
        </Link>
        {!relistId && <span className="eyebrow">Passo 2 de 2</span>}
        <h1 className="page-title">{relistId ? 'Relistar item' : 'Criar o leilão'}</h1>
      </div>

      {loadError ? (
        <ErrorState message={loadError} />
      ) : loading ? (
        <Spinner label="Carregando…" />
      ) : (
        <form className="two-col" onSubmit={handleSubmit} noValidate>
          <div className="main">
            <fieldset>
              <legend>{items.length > 1 ? 'Itens do lote' : 'Item'}</legend>
              {items.length === 0 ? (
                <div className="empty" style={{ padding: 24 }}>
                  <span style={{ fontWeight: 600 }}>Não encontramos esses itens no seu inventário</span>
                  <Link to="/anunciar" className="btn btn-secondary">
                    Escolher itens
                  </Link>
                </div>
              ) : (
                <div className="stack">
                  {items.map((i, idx) => (
                    <div key={i.id} className="item-pick" style={{ cursor: 'default' }}>
                      <span className="thumb-sm">
                        <Photo src={i.images[0]} alt="" />
                      </span>
                      <span className="stack" style={{ gap: 0, flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 600 }}>{i.name}</span>
                        <span className="small muted">
                          {CATEGORY_LABEL[i.category]}
                          {items.length > 1 && idx === 0 ? ' · capa do lote' : ''}
                        </span>
                      </span>
                      {!isAvailable(i) && <span className="badge badge-live-soft">Indisponível</span>}
                      {items.length > 1 && (
                        <span className="row" style={{ gap: 4 }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={idx === 0}
                            aria-label={`Subir ${i.name}${idx === 1 ? ' (vira a capa)' : ''}`}
                            title={idx === 1 ? 'Usar como capa do lote' : 'Subir'}
                            onClick={() => moveItem(idx, idx - 1)}
                          >
                            <ArrowUp size={16} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={idx === items.length - 1}
                            aria-label={`Descer ${i.name}`}
                            title="Descer"
                            onClick={() => moveItem(idx, idx + 1)}
                          >
                            <ArrowDown size={16} aria-hidden />
                          </button>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {blocked.length > 0 && (
                <div className="alert alert-danger" role="alert">
                  {blocked.length === 1 ? 'Um item' : 'Alguns itens'} já está em outro leilão aberto ou foi vendido.
                  Troque a seleção para continuar.
                </div>
              )}
              {!relistId && items.length > 0 && (
                <Link to={changeLink} className="small" style={{ fontWeight: 600, alignSelf: 'flex-start' }}>
                  Trocar itens
                </Link>
              )}
            </fieldset>

            <fieldset>
              <legend>O leilão</legend>
              <div className="field">
                <label htmlFor="cr-titulo">Título do anúncio</label>
                <input
                  id="cr-titulo"
                  className="input"
                  placeholder={single ? single.name : 'Ex.: Lote de câmeras antigas'}
                  maxLength={LIMITS.AUCTION_TITLE_MAX}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <span className="hint">
                  {single ? 'Opcional: se ficar vazio, usamos o nome do item.' : 'Obrigatório para lotes com vários itens.'}
                </span>
              </div>
              <div className="field">
                <label htmlFor="cr-adesc">Descrição do leilão</label>
                <textarea
                  id="cr-adesc"
                  className="textarea"
                  rows={4}
                  maxLength={LIMITS.AUCTION_DESCRIPTION_MAX}
                  placeholder={single ? 'Opcional: se ficar vazia, usamos a descrição do item.' : 'O que vem no lote, condições de entrega…'}
                  value={auctionDescription}
                  onChange={(e) => setAuctionDescription(e.target.value)}
                />
              </div>
              <div className="grid-3">
                <div className="field">
                  <label htmlFor="cr-preco">Preço inicial</label>
                  <div className="money-input">
                    <span>R$</span>
                    <input
                      id="cr-preco"
                      type="text"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      onBlur={() => !Number.isNaN(priceCents) && setPrice(moneyPlain(priceCents))}
                      aria-invalid={price !== '' && (Number.isNaN(priceCents) || priceCents < LIMITS.MIN_PRICE_CENTS)}
                    />
                  </div>
                  <span className="hint">Primeiro lance pode ser igual a este valor.</span>
                </div>
                <div className="field">
                  <label htmlFor="cr-inicio">Início</label>
                  <input
                    id="cr-inicio"
                    className="input"
                    type="datetime-local"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    aria-invalid={!checks.auction && leadMs < LIMITS.START_MIN_LEAD_MS}
                  />
                  <span className={`hint ${leadMs < LIMITS.START_MIN_LEAD_MS ? 'error' : ''}`}>De 1 min a 30 dias a partir de agora.</span>
                </div>
                <div className="field">
                  <label htmlFor="cr-dur">Duração</label>
                  <select id="cr-dur" className="select" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                    {DURATIONS.map((d) => (
                      <option key={d.seconds} value={d.seconds}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                  <span className="hint">De 3 min a 7 dias.</span>
                </div>
              </div>
              {!Number.isNaN(startDate.getTime()) && (
                <div className="alert alert-info">
                  <span>
                    Abre <b>{relativeDay(startDate)}</b> e termina <b>{relativeDay(endDate)}</b> (seu horário). Lances no fim
                    podem prorrogar até 30 min.
                  </span>
                </div>
              )}
            </fieldset>
          </div>

          <aside className="side" style={{ position: 'sticky', top: 90 }}>
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="small muted" style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', fontWeight: 600 }}>
                Prévia na listagem
              </div>
              <div style={{ height: 170, position: 'relative', background: 'var(--muted-bg)' }}>
                <Photo src={items[0]?.images[0]} alt="" />
                <span className="badge badge-scheduled" style={{ position: 'absolute', top: 12, left: 12, background: '#fff' }}>
                  Abre às {Number.isNaN(startDate.getTime()) ? '--:--' : hhmm(startDate)}
                </span>
              </div>
              <div className="stack" style={{ padding: 16, gap: 6 }}>
                <span className="eyebrow">{items[0] ? CATEGORY_LABEL[items[0].category] : 'Categoria'}</span>
                <span style={{ fontWeight: 600, fontSize: 17 }}>{effectiveTitle || 'Título do anúncio'}</span>
                <span className="display num" style={{ fontSize: 22 }}>
                  {Number.isNaN(priceCents) ? 'R$ —' : money(priceCents)}
                </span>
              </div>
            </div>

            <div className="panel">
              <span style={{ fontWeight: 700 }}>Antes de publicar</span>
              <div className="checklist">
                <Check3 ok={checks.items} text={items.length > 1 ? `${items.length} itens disponíveis no lote` : 'Item disponível'} />
                <Check3 ok={checks.title} text="Título com pelo menos 3 letras" />
                <Check3 ok={checks.auction} text="Preço, início e duração" />
              </div>
              {error && (
                <div className="alert alert-danger" role="alert">
                  {error}
                </div>
              )}
              <button type="submit" className="btn btn-primary btn-block btn-bid" disabled={!ready || sending}>
                {sending && <span className="spinner" aria-hidden />}
                {sending ? 'Publicando…' : 'Publicar leilão'}
              </button>
            </div>
          </aside>
        </form>
      )}

      {confirming && (
        <Dialog title="Publicar leilão?" onClose={() => setConfirming(false)}>
          <span className="muted">
            Você pode cancelar enquanto o leilão não tiver lances. Depois do primeiro lance, só dá para acrescentar
            texto à descrição.
          </span>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>
              Revisar
            </button>
            <button type="button" className="btn btn-primary" onClick={publish} autoFocus>
              Publicar leilão
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
