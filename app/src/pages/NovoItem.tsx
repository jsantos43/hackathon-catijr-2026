import { ArrowLeft, ImagePlus, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check3 } from '../components/ui';
import { LIMITS } from '../config';
import { itemsQuery } from '../lib/inventory';
import { CATEGORIES, CATEGORY_LABEL, uuid } from '../lib/format';
import { errorMessage } from '../services/api';
import { itemService } from '../services/itemService';
import type { Category } from '../types';

type PhotoEntry = { id: string; file: File; url: string; error?: string };

const validatePhoto = (f: File) => {
  if (!(LIMITS.PHOTO_TYPES as readonly string[]).includes(f.type)) return 'formato não aceito';
  if (f.size > LIMITS.PHOTO_MAX_BYTES) return 'maior que 5 MB';
  return undefined;
};

/** Cadastra um item no inventário e segue para a criação do leilão com ele. */
export default function NovoItem() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('ELECTRONICS');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Libera as URLs de prévia ao sair.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const validPhotos = photos.filter((p) => !p.error);
  const checks = {
    info: name.trim().length >= 3 && description.trim().length >= 10,
    photos: validPhotos.length >= LIMITS.PHOTOS_MIN,
  };
  const ready = checks.info && checks.photos;

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
    setProgress(0);
    try {
      const item = await itemService.create(
        { name: name.trim(), description: description.trim(), category },
        validPhotos.map((p) => p.file),
        setProgress,
      );
      navigate(`/anunciar/leilao?${itemsQuery([item.id])}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível cadastrar o item.'));
      setSending(false);
      setProgress(null);
    }
  }

  return (
    <main className="page">
      <div className="stack">
        <Link to="/anunciar" className="row small" style={{ gap: 6, textDecoration: 'none', fontWeight: 600 }}>
          <ArrowLeft size={16} aria-hidden /> Meu inventário
        </Link>
        <span className="eyebrow">Passo 1 de 2</span>
        <h1 className="page-title">Cadastrar item novo</h1>
        <span className="muted">O item fica no seu inventário; em seguida você define o leilão.</span>
      </div>

      <form className="two-col" onSubmit={handleSubmit} noValidate>
        <div className="main">
          <fieldset>
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
        </div>

        <aside className="side" style={{ position: 'sticky', top: 90 }}>
          <div className="panel">
            <span style={{ fontWeight: 700 }}>Antes de continuar</span>
            <div className="checklist">
              <Check3 ok={checks.info} text="Nome, categoria e descrição" />
              <Check3
                ok={checks.photos}
                text={`Pelo menos ${LIMITS.PHOTOS_MIN} fotos válidas (${Math.min(validPhotos.length, LIMITS.PHOTOS_MIN)} de ${LIMITS.PHOTOS_MIN})`}
              />
            </div>
            {error && (
              <div className="alert alert-danger" role="alert">
                {error}
              </div>
            )}
            <button type="submit" className="btn btn-primary btn-block btn-bid" disabled={!ready || sending}>
              {sending && <span className="spinner" aria-hidden />}
              {sending ? (progress !== null && progress < 100 ? `Enviando fotos ${progress}%…` : 'Salvando…') : 'Salvar e criar leilão'}
            </button>
          </div>
        </aside>
      </form>
    </main>
  );
}
