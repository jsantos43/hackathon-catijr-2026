import { ArrowLeft, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import PhotoManager from '../components/PhotoManager';
import { existingPhotos, validPhotos, type PhotoEntry } from '../lib/photos';
import { Check3, Dialog, ErrorState, PageLoader } from '../components/ui';
import { LIMITS } from '../config';
import { CATEGORIES, CATEGORY_LABEL, relativeDay } from '../lib/format';
import { itemsQuery } from '../lib/inventory';
import { serverNow } from '../lib/serverClock';
import { errorMessage } from '../services/api';
import { itemService } from '../services/itemService';
import type { Category, OwnItem } from '../types';

/**
 * Por que o item não pode ser editado agora (mesma regra da API, RF23): está num leilão em
 * andamento ou num agendado que começa em menos de 30 min. null = pode editar.
 */
const editLock = (item: OwnItem) => {
  const running = item.auctions.find((a) => a.status === 'RUNNING');
  if (running) return `O item está no leilão “${running.title}”, em andamento. Durante a disputa só dá para acrescentar texto à descrição do leilão.`;
  const soon = item.auctions.find(
    (a) => a.status === 'SCHEDULED' && Date.parse(a.startsAt) - serverNow() <= LIMITS.EDIT_LOCK_MS,
  );
  if (soon) return `O leilão “${soon.title}” começa ${relativeDay(soon.startsAt)}. A menos de 30 minutos do início o anúncio não muda mais.`;
  return null;
};

/**
 * Cadastro (`/anunciar/novo-item`) e edição (`/itens/:id/editar`) de um item do inventário.
 * No cadastro, segue para o leilão com o item; na edição, volta para onde veio (`?voltar=`).
 */
export default function ItemForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const back = params.get('voltar') || '/anunciar';

  const [item, setItem] = useState<OwnItem | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('ELECTRONICS');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!id) return;
    itemService
      .get(id)
      .then((it) => {
        setItem(it);
        setName(it.name);
        setCategory(it.category);
        setDescription(it.description);
        setPhotos(existingPhotos(it.images));
      })
      .catch((e) => setLoadError(errorMessage(e)));
  }, [id]);

  const valid = validPhotos(photos);
  const lock = item ? editLock(item) : null;
  const checks = {
    info: name.trim().length >= 3 && description.trim().length >= 10,
    photos: valid.length >= LIMITS.PHOTOS_MIN && valid.length <= LIMITS.PHOTOS_MAX,
  };
  const ready = checks.info && checks.photos && !lock;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ready || sending) return;
    setSending(true);
    setError(null);
    const newFiles = valid.flatMap((p) => (p.kind === 'new' ? [p.file] : []));
    setProgress(newFiles.length ? 0 : null);
    const fields = { name: name.trim(), description: description.trim(), category };

    try {
      if (editing && item) {
        // Ordem final das fotos: atuais pela URL e novas como "new:N" (N = posição no envio).
        let n = 0;
        const order = valid.map((p) => (p.kind === 'existing' ? p.url : `new:${n++}`));
        await itemService.update(item.id, fields, newFiles, order, setProgress);
        navigate(back, { replace: true });
      } else {
        const created = await itemService.create(fields, newFiles, setProgress);
        navigate(`/anunciar/leilao?${itemsQuery([created.id])}`, { replace: true });
      }
    } catch (err) {
      setError(errorMessage(err, editing ? 'Não foi possível salvar o item.' : 'Não foi possível cadastrar o item.'));
      setSending(false);
      setProgress(null);
    }
  }

  async function handleDelete() {
    if (!item) return;
    setSending(true);
    try {
      await itemService.delete(item.id);
      navigate('/anunciar', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível excluir o item.'));
      setConfirmDelete(false);
      setSending(false);
    }
  }

  if (editing && loadError)
    return (
      <main className="page">
        <ErrorState message={loadError} />
      </main>
    );
  if (editing && !item) return <PageLoader />;

  return (
    <main className="page">
      <div className="stack">
        <Link to={back} className="row small" style={{ gap: 6, textDecoration: 'none', fontWeight: 600 }}>
          <ArrowLeft size={16} aria-hidden /> {back === '/anunciar' ? 'Meu inventário' : 'Voltar'}
        </Link>
        {!editing && <span className="eyebrow">Passo 1 de 2</span>}
        <h1 className="page-title">{editing ? 'Editar item' : 'Cadastrar item novo'}</h1>
        <span className="muted">
          {editing
            ? 'As mudanças aparecem em todos os leilões deste item que ainda não começaram.'
            : 'O item fica no seu inventário; em seguida você define o leilão.'}
        </span>
      </div>

      {lock && (
        <div className="alert alert-warn" role="status">
          {lock}
        </div>
      )}

      <form className="two-col" onSubmit={handleSubmit} noValidate>
        <div className="main">
          <fieldset disabled={!!lock}>
            <legend>O item</legend>
            <div className="field">
              <label htmlFor="ni-nome">Nome</label>
              <input id="ni-nome" className="input" value={name} maxLength={LIMITS.ITEM_NAME_MAX} onChange={(e) => setName(e.target.value)} required />
              <span className="counter">
                {name.length} / {LIMITS.ITEM_NAME_MAX}
              </span>
            </div>
            <div className="field">
              <label htmlFor="ni-cat">Categoria</label>
              <select id="ni-cat" className="select" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ni-desc">Descrição</label>
              <textarea
                id="ni-desc"
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
            <legend>Fotos</legend>
            <span className="hint">
              De {LIMITS.PHOTOS_MIN} a {LIMITS.PHOTOS_MAX} fotos · JPG, PNG ou WebP · até 5 MB cada. A primeira é a
              capa: use as setas ou a estrela para mudar a ordem.
            </span>
            <PhotoManager photos={photos} onChange={setPhotos} disabled={!!lock || sending} />
            {progress !== null && (
              <div className="stack" style={{ gap: 4 }}>
                <div className="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                  <div style={{ width: `${progress}%` }} />
                </div>
                <span className="small muted">Enviando {progress}%</span>
              </div>
            )}
          </fieldset>
        </div>

        <aside className="side" style={{ position: 'sticky', top: 90 }}>
          <div className="panel">
            <span style={{ fontWeight: 700 }}>{editing ? 'Antes de salvar' : 'Antes de continuar'}</span>
            <div className="checklist">
              <Check3 ok={checks.info} text="Nome, categoria e descrição" />
              <Check3
                ok={checks.photos}
                text={`De ${LIMITS.PHOTOS_MIN} a ${LIMITS.PHOTOS_MAX} fotos válidas (${valid.length} agora)`}
              />
            </div>
            {error && (
              <div className="alert alert-danger" role="alert">
                {error}
              </div>
            )}
            <button type="submit" className="btn btn-primary btn-block btn-bid" disabled={!ready || sending}>
              {sending && <span className="spinner" aria-hidden />}
              {sending
                ? progress !== null && progress < 100
                  ? `Enviando fotos ${progress}%…`
                  : 'Salvando…'
                : editing
                  ? 'Salvar alterações'
                  : 'Salvar e criar leilão'}
            </button>
            {editing && item && item.auctions.length === 0 && (
              <button type="button" className="btn btn-ghost btn-block" style={{ color: 'var(--danger)' }} disabled={sending} onClick={() => setConfirmDelete(true)}>
                <Trash2 size={16} aria-hidden /> Excluir item
              </button>
            )}
            {editing && item && item.auctions.length > 0 && (
              <span className="small muted">Itens que já foram leiloados ficam guardados para o histórico e não podem ser excluídos.</span>
            )}
          </div>
        </aside>
      </form>

      {confirmDelete && item && (
        <Dialog title="Excluir este item?" onClose={() => setConfirmDelete(false)}>
          <p className="muted">“{item.name}” e as fotos dele saem do seu inventário. Não dá para desfazer.</p>
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>
              Manter
            </button>
            <button type="button" className="btn btn-danger" disabled={sending} onClick={handleDelete}>
              Excluir item
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}

