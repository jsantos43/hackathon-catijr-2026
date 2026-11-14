import { Gavel, ImageIcon, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { avatarColor, initials, STATUS_LABEL } from '../lib/format';
import type { AuctionStatus } from '../types';

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="logo" aria-label="Arremate, página inicial">
      <span className="logo-mark">
        <Gavel size={20} strokeWidth={2} aria-hidden />
      </span>
      <span className="logo-name">Arremate</span>
    </Link>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" role="status">
      <span className="spinner" aria-hidden />
      {label && <span>{label}</span>}
    </span>
  );
}

export function PageLoader() {
  return (
    <div className="page" style={{ alignItems: 'center', paddingTop: 96 }}>
      <Spinner label="Carregando…" />
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty" role="alert">
      <span style={{ fontWeight: 600, fontSize: 18 }}>Não foi possível carregar</span>
      <span className="muted small">{message}</span>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Tentar de novo
        </button>
      )}
    </div>
  );
}

export function Avatar({ id, name, size = 40, self }: { id: string; name: string; size?: number; self?: boolean }) {
  const [bg, fg] = self ? ['var(--primary)', '#fff'] : avatarColor(id);
  return (
    <span
      className="avatar"
      aria-hidden
      style={{ background: bg, color: fg, width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {self ? 'Eu' : initials(name)}
    </span>
  );
}

const STATUS_CLASS: Record<AuctionStatus, string> = {
  SCHEDULED: 'badge-scheduled',
  RUNNING: 'badge-running',
  SOLD: 'badge-sold',
  ENDED_NO_BIDS: 'badge-ended',
  CANCELLED: 'badge-cancelled',
};

export function StatusBadge({ status, text }: { status: AuctionStatus; text?: string }) {
  return (
    <span className={`badge ${STATUS_CLASS[status]}`}>
      {status === 'RUNNING' && <span className="dot" aria-hidden />}
      {text ?? (status === 'RUNNING' ? 'Ao vivo' : STATUS_LABEL[status])}
    </span>
  );
}

/** Foto com placeholder quando não há imagem ou ela falha. */
export function Photo({ src, alt }: { src?: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed)
    return (
      <div className="img-placeholder">
        <ImageIcon size={28} strokeWidth={1.6} aria-hidden />
        <span>Foto do item</span>
      </div>
    );
  return <img className="img-fill" src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

export function Gallery({ images, alt, badge }: { images: string[]; alt: string; badge?: ReactNode }) {
  const [index, setIndex] = useState(0);
  const current = Math.min(index, Math.max(0, images.length - 1));
  return (
    <section aria-label="Fotos" className="stack" style={{ gap: 12 }}>
      <div className="gallery-main">
        <Photo src={images[current]} alt={`${alt} — foto ${current + 1}`} />
        {badge && <span className="state-badge">{badge}</span>}
        {images.length > 0 && (
          <span className="badge counter-badge">
            Foto {current + 1} de {images.length}
          </span>
        )}
      </div>
      {images.length > 1 && (
        <div className="thumbs">
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              aria-label={`Foto ${i + 1}`}
              aria-current={i === current}
              onClick={() => setIndex(i)}
            >
              <img className="img-fill" src={src} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <h2 id="dialog-title">{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Fechar">
            <X size={18} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

