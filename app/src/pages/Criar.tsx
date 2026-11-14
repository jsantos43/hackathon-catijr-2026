import { AlertCircle, ArrowLeft, Check, ImagePlus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Photo } from '../components/ui';
import { DURATIONS, LIMITS } from '../config';
import { CATEGORIES, CATEGORY_LABEL, hhmm, money, moneyPlain, parseMoney, relativeDay, toLocalInput, uuid } from '../lib/format';
import { serverNow } from '../lib/serverClock';
import { errorMessage } from '../services/api';
import { auctionService } from '../services/auctionService';
import { itemService } from '../services/itemService';
import type { Category, OwnItem } from '../types';

type PhotoEntry = { id: string; file: File; url: string; error?: string };
type Mode = 'new' | 'existing';

const validatePhoto = (f: File) => {
  if (!(LIMITS.PHOTO_TYPES as readonly string[]).includes(f.type)) return 'formato não aceito';
  if (f.size > LIMITS.PHOTO_MAX_BYTES) return 'maior que 5 MB';
  return undefined;
};

// Item disponível para um lote novo: não está em leilão aberto e nunca foi vendido (RF28).
const isAvailable = (i: OwnItem) => !i.auctions.some((a) => ['SCHEDULED', 'RUNNING', 'SOLD'].includes(a.status));

const defaultStart = () => {
  const d = new Date(serverNow() + 5 * 60 * 1000);
  d.setSeconds(0, 0);
  return toLocalInput(d);
};

export default function Criar() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const relistId = params.get('relistar');

  const [mode, setMode] = useState<Mode>(relistId ? 'existing' : 'new');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('ELECTRONICS');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);

  const [ownItems, setOwnItems] = useState<OwnItem[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const [title, setTitle] = useState('');
  const [auctionDescription, setAuctionDescription] = useState('');
  const [price, setPrice] = useState('');
  const [start, setStart] = useState(defaultStart);
  const [duration, setDuration] = useState(30 * 60);

  const [progress, setProgress] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Se o item subiu e o leilão falhou, reaproveita o item na próxima tentativa (sem reenviar fotos).
  const createdItemId = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    itemService
      .listOwn()
      .then(setOwnItems)
      .catch(() => setOwnItems([]));
  }, []);

  // Relistar (RF28): parte dos dados do leilão antigo.
  useEffect(() => {
    if (!relistId) return;
    auctionService
      .get(relistId)
      .then((a) => {
        setSelected(a.items.map((i) => i.id));
        setTitle(a.title);
        setAuctionDescription(a.description);
        setPrice(moneyPlain(a.startingPriceCents));
        const dur = Math.round((Date.parse(a.originalEndsAt) - Date.parse(a.startsAt)) / 1000);
        if (DURATIONS.some((d) => d.seconds === dur)) setDuration(dur);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [relistId]);

  // Libera as URLs de prévia ao sair.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const validPhotos = photos.filter((p) => !p.error);
  const available = useMemo(() => (ownItems ?? []).filter((i) => isAvailable(i) || selected.includes(i.id)), [ownItems, selected]);
  const selectedItems = available.filter((i) => selected.includes(i.id));

  const priceCents = parseMoney(price);
  const startDate = new Date(start);
  const leadMs = startDate.getTime() - serverNow();
  const endDate = new Date(startDate.getTime() + duration * 1000);

  const checks = {
    item:
      mode === 'new'
        ? name.trim().length >= 3 && description.trim().length >= 10
        : selected.length > 0,
    photos: mode === 'new' ? validPhotos.length >= LIMITS.PHOTOS_MIN : true,
    auction:
      !Number.isNaN(priceCents) &&
      priceCents >= LIMITS.MIN_PRICE_CENTS &&
      !Number.isNaN(startDate.getTime()) &&
      leadMs >= LIMITS.START_MIN_LEAD_MS &&
      leadMs <= LIMITS.START_MAX_LEAD_MS,
  };
  const ready = checks.item && checks.photos && checks.auction;

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const room = LIMITS.PHOTOS_MAX - validPhotos.length;
    const entries = Array.from(files).map((file) => ({ id: uuid(), file, url: URL.createObjectURL(file), error: validatePhoto(file) }));
    let accepted = 0;
    const capped = entries.map((e) => {
      if (e.error) return e;
      accepted += 1;
      return accepted > room ? { ...e, error: `máximo de ${LIMITS.PHOTOS_MAX} fotos` } : e;
    });
    setPhotos((p) => [...p, ...capped]);
    if (fileInput.current) fileInput.current.value = '';
  };

  const removePhoto = (id: string) =>
    setPhotos((list) => {
      const p = list.find((x) => x.id === id);
      if (p) URL.revokeObjectURL(p.url);
      return list.filter((x) => x.id !== id);
    });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ready || sending) return;
    setSending(true);
    setError(null);
    try {
      let itemIds = selected;
      if (mode === 'new') {
        if (!createdItemId.current) {
          setProgress(0);
          const item = await itemService.create(
            { name: name.trim(), description: description.trim(), category },
            validPhotos.map((p) => p.file),
            setProgress,
          );
          createdItemId.current = item.id;
        }
        itemIds = [createdItemId.current];
      }
      const auction = await auctionService.create({
        title: (title.trim() || name.trim()).slice(0, LIMITS.AUCTION_TITLE_MAX),
        description: mode === 'new' ? auctionDescription.trim() || description.trim() : auctionDescription.trim(),
        itemIds,
        startingPriceCents: priceCents,
        startsAt: startDate.toISOString(),
        durationSeconds: duration,
      });
      navigate(`/leiloes/${auction.id}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível publicar o leilão.'));
      setSending(false);
      setProgress(null);
    }
  }

  const previewImage = mode === 'new' ? validPhotos[0]?.url : selectedItems[0]?.images[0];
  const previewName = title.trim() || (mode === 'new' ? name.trim() : selectedItems[0]?.name) || 'Nome do item';
  const previewCat = mode === 'new' ? category : selectedItems[0]?.category;

  return (
    <main className="page">
      <div className="stack">
        <Link to="/meus-leiloes" className="row small" style={{ gap: 6, textDecoration: 'none', fontWeight: 600 }}>
          <ArrowLeft size={16} aria-hidden /> Meus leilões
        </Link>
        <h1 className="page-title">{relistId ? 'Relistar item' : 'Anunciar um item'}</h1>
        <span className="muted">O leilão abre e fecha sozinho no horário que você escolher.</span>
      </div>

      <form className="two-col" onSubmit={handleSubmit} noValidate>
        <div className="main">
          <div className="segmented" role="group" aria-label="Origem dos itens" style={{ alignSelf: 'flex-start' }}>
            <button type="button" aria-pressed={mode === 'new'} onClick={() => setMode('new')}>
              Cadastrar item novo
            </button>
            <button type="button" aria-pressed={mode === 'existing'} onClick={() => setMode('existing')}>
              Usar itens já cadastrados{ownItems ? ` (${ownItems.filter(isAvailable).length})` : ''}
            </button>
          </div>

          {mode === 'new' ? (
            <>
              <fieldset>
                <legend>1 · O item</legend>
                <div className="field">
                  <label htmlFor="cr-nome">Nome</label>
                  <input id="cr-nome" className="input" value={name} maxLength={LIMITS.ITEM_NAME_MAX} onChange={(e) => setName(e.target.value)} required />
                  <span className="counter">
                    {name.length} / {LIMITS.ITEM_NAME_MAX}
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="cr-cat">Categoria</label>
                  <select id="cr-cat" className="select" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="cr-desc">Descrição</label>
                  <textarea
                    id="cr-desc"
                    className="textarea"
                    rows={5}
                    maxLength={LIMITS.ITEM_DESCRIPTION_MAX}
                    placeholder="Estado de conservação, o que acompanha, detalhes de uso."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                  <span className="counter">
                    {description.length.toLocaleString('pt-BR')} / {LIMITS.ITEM_DESCRIPTION_MAX.toLocaleString('pt-BR')}
                  </span>
                </div>
              </fieldset>

              <fieldset>
                <legend>2 · Fotos</legend>
                <span className="hint">
                  De {LIMITS.PHOTOS_MIN} a {LIMITS.PHOTOS_MAX} fotos · JPG, PNG ou WebP · até 5 MB cada. A primeira é a capa.
                </span>
                <div className="photo-grid">
                  {photos.map((p) =>
                    p.error ? (
                      <div key={p.id} className="photo-tile invalid" style={{ position: 'relative' }}>
                        <span>
                          {p.file.name}
                          <br />
                          {p.error}
                        </span>
                        <button type="button" className="remove" aria-label={`Remover ${p.file.name}`} onClick={() => removePhoto(p.id)}>
                          <X size={14} aria-hidden />
                        </button>
                      </div>
                    ) : (
                      <div key={p.id} className="photo-tile">
                        <img className="img-fill" src={p.url} alt={p.file.name} />
                        {validPhotos[0]?.id === p.id && <span className="badge tag">Capa</span>}
                        <button type="button" className="remove" aria-label={`Remover ${p.file.name}`} onClick={() => removePhoto(p.id)}>
                          <X size={14} aria-hidden />
                        </button>
                      </div>
                    ),
                  )}
                  {validPhotos.length < LIMITS.PHOTOS_MAX && (
                    <label className="photo-add">
                      <ImagePlus size={22} aria-hidden />
                      Adicionar fotos
                      <input
                        ref={fileInput}
                        type="file"
                        accept={LIMITS.PHOTO_TYPES.join(',')}
                        multiple
                        className="sr-only"
                        onChange={(e) => addFiles(e.target.files)}
                      />
                    </label>
                  )}
                </div>
                {progress !== null && (
                  <div className="stack" style={{ gap: 4 }}>
                    <div className="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                      <div style={{ width: `${progress}%` }} />
                    </div>
                    <span className="small muted">Enviando {progress}%</span>
                  </div>
                )}
                <span className="hint">As fotos vão direto para o armazenamento em nuvem; nada fica no servidor da aplicação.</span>
              </fieldset>
            </>
          ) : (
            <fieldset>
              <legend>1 · Itens do lote</legend>
              <span className="hint">
                Itens que não estão em outro leilão aberto e não foram vendidos. Um leilão pode ter vários itens; o
                primeiro é a capa.
              </span>
              {ownItems === null && <span className="muted">Carregando seus itens…</span>}
              {ownItems && available.length === 0 && (
                <div className="empty" style={{ padding: 24 }}>
                  <span style={{ fontWeight: 600 }}>Nenhum item disponível</span>
                  <button type="button" className="btn btn-secondary" onClick={() => setMode('new')}>
                    Cadastrar item novo
                  </button>
                </div>
              )}
              <div className="stack">
                {available.map((i) => (
                  <label key={i.id} className="item-pick">
                    <input
                      type="checkbox"
                      checked={selected.includes(i.id)}
                      onChange={(e) =>
                        setSelected((s) => (e.target.checked ? [...s, i.id] : s.filter((x) => x !== i.id)))
                      }
                    />
                    <span className="thumb-sm">
                      <Photo src={i.images[0]} alt="" />
                    </span>
                    <span className="stack" style={{ gap: 0 }}>
                      <span style={{ fontWeight: 600 }}>{i.name}</span>
                      <span className="small muted">
                        {CATEGORY_LABEL[i.category]} · {i.auctions.length ? `${i.auctions.length} leilão(ões) antes` : 'nunca leiloado'}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="field">
                <label htmlFor="cr-adesc">Descrição do leilão</label>
                <textarea
                  id="cr-adesc"
                  className="textarea"
                  rows={4}
                  maxLength={LIMITS.AUCTION_DESCRIPTION_MAX}
                  value={auctionDescription}
                  onChange={(e) => setAuctionDescription(e.target.value)}
                />
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend>{mode === 'new' ? '3' : '2'} · O leilão</legend>
            <div className="field">
              <label htmlFor="cr-titulo">Título do anúncio</label>
              <input
                id="cr-titulo"
                className="input"
                placeholder={mode === 'new' ? name || 'Igual ao nome do item' : 'Ex.: Lote de câmeras antigas'}
                maxLength={LIMITS.AUCTION_TITLE_MAX}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <span className="hint">Opcional quando é um item só: usamos o nome do item.</span>
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
              <Photo src={previewImage} alt="" />
              <span className="badge badge-scheduled" style={{ position: 'absolute', top: 12, left: 12, background: '#fff' }}>
                Abre às {Number.isNaN(startDate.getTime()) ? '--:--' : hhmm(startDate)}
              </span>
            </div>
            <div className="stack" style={{ padding: 16, gap: 6 }}>
              <span className="eyebrow">{previewCat ? CATEGORY_LABEL[previewCat] : 'Categoria'}</span>
              <span style={{ fontWeight: 600, fontSize: 17 }}>{previewName}</span>
              <span className="display num" style={{ fontSize: 22 }}>
                {Number.isNaN(priceCents) ? 'R$ —' : money(priceCents)}
              </span>
            </div>
          </div>

          <div className="panel">
            <span style={{ fontWeight: 700 }}>Antes de publicar</span>
            <div className="checklist">
              <Check3 ok={checks.item} text={mode === 'new' ? 'Nome, categoria e descrição' : 'Pelo menos 1 item no lote'} />
              {mode === 'new' && (
                <Check3
                  ok={checks.photos}
                  text={`Pelo menos ${LIMITS.PHOTOS_MIN} fotos válidas (${Math.min(validPhotos.length, LIMITS.PHOTOS_MIN)} de ${LIMITS.PHOTOS_MIN})`}
                />
              )}
              <Check3 ok={checks.auction} text="Preço, início e duração" />
            </div>
            {error && (
              <div className="alert alert-danger" role="alert">
                {error}
              </div>
            )}
            <button type="submit" className="btn btn-primary btn-block btn-bid" disabled={!ready || sending}>
              {sending && <span className="spinner" aria-hidden />}
              {sending ? (progress !== null && progress < 100 ? `Enviando fotos ${progress}%…` : 'Publicando…') : 'Publicar leilão'}
            </button>
            <span className="small muted">
              Você pode cancelar enquanto o leilão não tiver lances. Depois do primeiro lance, só dá para acrescentar
              texto à descrição.
            </span>
          </div>
        </aside>
      </form>
    </main>
  );
}

function Check3({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span className={ok ? 'ok' : 'pending'}>
      {ok ? <Check size={18} strokeWidth={2.4} aria-hidden /> : <AlertCircle size={18} aria-hidden />}
      {text}
    </span>
  );
}
