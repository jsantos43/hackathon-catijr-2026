import { ChevronLeft, ChevronRight, ImagePlus, Star, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { LIMITS } from '../config';
import { uuid } from '../lib/format';
import { validPhotos, type PhotoEntry } from '../lib/photos';

const validateFile = (f: File) => {
  if (!(LIMITS.PHOTO_TYPES as readonly string[]).includes(f.type)) return 'formato não aceito';
  if (f.size > LIMITS.PHOTO_MAX_BYTES) return 'maior que 5 MB';
  return undefined;
};

const nameOf = (p: PhotoEntry, index: number) => (p.kind === 'new' ? p.file.name : `foto ${index + 1}`);

/**
 * Grade de fotos com ordem editável: a primeira é a capa. Dá para trocar a capa, mover
 * cada foto para os lados, remover e adicionar (respeitando o máximo).
 */
export default function PhotoManager({
  photos,
  onChange,
  disabled,
}: {
  photos: PhotoEntry[];
  onChange: (next: PhotoEntry[]) => void;
  disabled?: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const valid = validPhotos(photos);

  // Libera as URLs de prévia (blob:) das fotos novas ao desmontar.
  const ref = useRef(photos);
  useEffect(() => {
    ref.current = photos;
  }, [photos]);
  useEffect(
    () => () => ref.current.forEach((p) => p.kind === 'new' && URL.revokeObjectURL(p.url)),
    [],
  );

  const add = (files: FileList | null) => {
    if (!files) return;
    let room = LIMITS.PHOTOS_MAX - valid.length;
    const entries: PhotoEntry[] = Array.from(files).map((file) => {
      const error = validateFile(file) ?? (room-- > 0 ? undefined : `máximo de ${LIMITS.PHOTOS_MAX} fotos`);
      return { id: uuid(), kind: 'new', file, url: URL.createObjectURL(file), error };
    });
    onChange([...photos, ...entries]);
    if (fileInput.current) fileInput.current.value = '';
  };

  const remove = (id: string) => {
    const p = photos.find((x) => x.id === id);
    if (p?.kind === 'new') URL.revokeObjectURL(p.url);
    onChange(photos.filter((x) => x.id !== id));
  };

  /** Move dentro da lista de fotos válidas (as inválidas ficam no fim, só para avisar). */
  const move = (id: string, to: number) => {
    const order = valid.filter((p) => p.id !== id);
    const item = valid.find((p) => p.id === id);
    if (!item) return;
    order.splice(Math.max(0, Math.min(to, order.length)), 0, item);
    onChange([...order, ...photos.filter((p) => !valid.includes(p))]);
  };

  return (
    <div className="photo-grid">
      {valid.map((p, idx) => (
        <div key={p.id} className="photo-tile">
          <img className="img-fill" src={p.url} alt={nameOf(p, idx)} />
          {idx === 0 && <span className="badge tag">Capa</span>}
          <button
            type="button"
            className="remove"
            disabled={disabled}
            aria-label={`Remover ${nameOf(p, idx)}`}
            onClick={() => remove(p.id)}
          >
            <X size={14} aria-hidden />
          </button>
          {valid.length > 1 && (
            <div className="photo-actions">
              <button
                type="button"
                disabled={disabled || idx === 0}
                aria-label={`Mover ${nameOf(p, idx)} para a esquerda`}
                onClick={() => move(p.id, idx - 1)}
              >
                <ChevronLeft size={16} aria-hidden />
              </button>
              {idx > 0 && (
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Usar ${nameOf(p, idx)} como capa`}
                  title="Usar como capa"
                  onClick={() => move(p.id, 0)}
                >
                  <Star size={14} aria-hidden />
                </button>
              )}
              <button
                type="button"
                disabled={disabled || idx === valid.length - 1}
                aria-label={`Mover ${nameOf(p, idx)} para a direita`}
                onClick={() => move(p.id, idx + 1)}
              >
                <ChevronRight size={16} aria-hidden />
              </button>
            </div>
          )}
        </div>
      ))}

      {photos
        .filter((p): p is Extract<PhotoEntry, { kind: 'new' }> => p.kind === 'new' && !!p.error)
        .map((p) => (
          <div key={p.id} className="photo-tile invalid">
            <span>
              {p.file.name}
              <br />
              {p.error}
            </span>
            <button type="button" className="remove" aria-label={`Remover ${p.file.name}`} onClick={() => remove(p.id)}>
              <X size={14} aria-hidden />
            </button>
          </div>
        ))}

      {valid.length < LIMITS.PHOTOS_MAX && !disabled && (
        <label className="photo-add">
          <ImagePlus size={22} aria-hidden />
          Adicionar fotos
          <input
            ref={fileInput}
            type="file"
            accept={LIMITS.PHOTO_TYPES.join(',')}
            multiple
            className="sr-only"
            onChange={(e) => add(e.target.files)}
          />
        </label>
      )}
    </div>
  );
}
