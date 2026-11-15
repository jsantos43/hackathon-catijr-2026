import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AuctionCard from '../components/AuctionCard';
import CategoryPicker from '../components/CategoryPicker';
import { ErrorState, Spinner } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useNow } from '../hooks/useNow';
import { CATEGORIES, CATEGORY_LABEL, plural, timezoneLabel } from '../lib/format';
import { errorMessage } from '../services/api';
import { auctionService, type AuctionSort } from '../services/auctionService';
import type { Auction, AuctionStatus, Category } from '../types';

/** Por padrão a vitrine mostra os abertos: primeiro os Em andamento, depois os Agendados. */
const OPEN_STATUSES: AuctionStatus[] = ['RUNNING', 'SCHEDULED'];

/** RF21: filtro por estado, combinável com busca e categorias. */
const STATUS_FILTERS: { value: AuctionStatus; label: string }[] = [
  { value: 'RUNNING', label: 'Ao vivo' },
  { value: 'SCHEDULED', label: 'Agendados' },
  { value: 'SOLD', label: 'Vendidos' },
  { value: 'ENDED_NO_BIDS', label: 'Sem lances' },
  { value: 'CANCELLED', label: 'Cancelados' },
];
const ALL_STATUSES = STATUS_FILTERS.map((f) => f.value);

const PAGE_SIZE = 12;

export default function Listagem() {
  const { isAuthenticated } = useAuth();
  const now = useNow();
  const [params, setParams] = useSearchParams();

  const q = params.get('q') ?? '';
  const catParam = params.get('categoria') ?? '';
  const cats = useMemo(
    () => catParam.split(',').filter((c): c is Category => (CATEGORIES as string[]).includes(c)),
    [catParam],
  );
  const statusParam = params.get('estado');
  const statuses = useMemo(() => {
    const list = (statusParam ?? '').split(',').filter((v): v is AuctionStatus => (ALL_STATUSES as string[]).includes(v));
    return list.length ? list : OPEN_STATUSES;
  }, [statusParam]);
  const [sort, setSort] = useState<AuctionSort>('live');
  const [search, setSearch] = useState(q);

  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);

  const setParam = (key: string, value: string | null) => {
    const p = new URLSearchParams(params);
    if (value) p.set(key, value);
    else p.delete(key);
    setPage(1); // filtro novo começa da primeira página
    setParams(p, { replace: true });
  };

  // Busca com debounce (300 ms) e reflete na URL.
  useEffect(() => {
    const t = setTimeout(() => {
      if (search.trim() !== q) setParam('q', search.trim() || null);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    auctionService
      .list({ status: ['RUNNING'], pageSize: 1 })
      .then((r) => setLiveCount(r.total))
      .catch(() => setLiveCount(null));
  }, []);

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    auctionService
      .list({ q, status: statuses, category: cats.length ? cats : undefined, sort, page, pageSize: PAGE_SIZE })
      .then((r) => {
        if (!active) return;
        setAuctions((prev) => (page === 1 ? r.items : [...prev, ...r.items.filter((a) => !prev.some((p) => p.id === a.id))]));
        setTotal(r.total);
      })
      .catch((e) => active && setError(errorMessage(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [q, cats, statuses, sort, page, retry]);

  // A ordem vem do servidor (?sort=). Leilões que acabaram de encerrar somem sem recarregar.
  const visible = useMemo(
    () => auctions.filter((a) => !(a.status === 'RUNNING' && Date.parse(a.endsAt) < now - 5000)),
    [auctions, now],
  );

  const setCats = (next: Category[]) => setParam('categoria', next.length ? next.join(',') : null);

  const toggleStatus = (value: AuctionStatus) => {
    const next = statuses.includes(value) ? statuses.filter((v) => v !== value) : [...statuses, value];
    const isDefault = next.length === OPEN_STATUSES.length && OPEN_STATUSES.every((v) => next.includes(v));
    // Desmarcar tudo volta ao padrão (abertos).
    setParam('estado', next.length && !isDefault ? ALL_STATUSES.filter((v) => next.includes(v)).join(',') : null);
  };

  return (
    <main className="page">
      <section className="row wrap between" style={{ alignItems: 'flex-end', gap: 24 }}>
        <div className="stack" style={{ gap: 10 }}>
          {liveCount !== null && liveCount > 0 && (
            <span className="badge badge-live-soft" style={{ alignSelf: 'flex-start' }}>
              <span className="dot" style={{ background: 'var(--live)' }} />
              {plural(liveCount, 'leilão ao vivo agora', 'leilões ao vivo agora')}
            </span>
          )}
          <h1 style={{ fontSize: 'clamp(32px, 5vw, 44px)', lineHeight: 1.12, letterSpacing: -1 }}>
            Encontre seu próximo arremate
          </h1>
        </div>
        <span className="small muted">Horários no seu fuso: {timezoneLabel()}</span>
      </section>

      <section aria-label="Busca e filtros" className="stack" style={{ gap: 12 }}>
        <div className="search-bar">
          <CategoryPicker value={cats} onChange={setCats} />
          <span className="search-divider" aria-hidden />
          <div className="search-field">
            <Search size={20} color="var(--ink-2)" aria-hidden />
            <label htmlFor="ls-busca" className="sr-only">
              Buscar leilões
            </label>
            <input
              id="ls-busca"
              type="search"
              placeholder="Buscar por nome do item, ex.: câmera"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="chips" role="group" aria-label="Filtrar por estado">
          <span className="small muted" style={{ alignSelf: 'center', marginRight: 4 }}>
            Estado:
          </span>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className="chip"
              aria-pressed={statuses.includes(f.value)}
              onClick={() => toggleStatus(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="row wrap between" style={{ gap: 12 }}>
          <div className="chips" aria-label="Categorias escolhidas">
            {cats.map((c) => (
              <button
                key={c}
                type="button"
                className="chip chip-remove"
                aria-pressed="true"
                aria-label={`Remover categoria ${CATEGORY_LABEL[c]}`}
                onClick={() => setCats(cats.filter((v) => v !== c))}
              >
                {CATEGORY_LABEL[c]}
                <X size={14} aria-hidden />
              </button>
            ))}
            {cats.length > 1 && (
              <button type="button" className="link-btn" onClick={() => setCats([])}>
                Limpar categorias
              </button>
            )}
          </div>
          <div className="row" style={{ gap: 8, marginLeft: 'auto' }}>
            <label htmlFor="ls-ordem" className="small muted">
              Ordenar
            </label>
            <select
              id="ls-ordem"
              className="select"
              style={{ width: 'auto' }}
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as AuctionSort);
                setPage(1); // ordem nova começa da primeira página
              }}
            >
              <option value="live">Ao vivo primeiro</option>
              <option value="ends">Terminam primeiro</option>
              <option value="starts">Começam primeiro</option>
              <option value="price">Menor preço</option>
              <option value="bids">Mais lances</option>
            </select>
          </div>
        </div>
      </section>

      {error ? (
        <ErrorState message={error} onRetry={() => setRetry((r) => r + 1)} />
      ) : (
        <>
          <span className="small muted" aria-live="polite">
            {loading && page === 1
              ? 'Buscando leilões…'
              : plural(total, 'leilão encontrado', 'leilões encontrados')}
          </span>

          {visible.length > 0 && (
            <section className="auction-grid">
              {visible.map((a) => (
                <AuctionCard key={a.id} auction={a} now={now} logged={isAuthenticated} />
              ))}
            </section>
          )}

          {!loading && visible.length === 0 && (
            <div className="empty">
              <span style={{ fontWeight: 600, fontSize: 18 }}>Nenhum leilão com esses filtros</span>
              <span className="small muted">Tente outra categoria, outro estado ou limpe a busca.</span>
            </div>
          )}

          {loading && page > 1 && <Spinner label="Carregando mais…" />}

          {!loading && auctions.length < total && (
            <button type="button" className="btn btn-secondary" style={{ alignSelf: 'center', height: 48, padding: '0 28px' }} onClick={() => setPage((p) => p + 1)}>
              Carregar mais leilões
            </button>
          )}
        </>
      )}
    </main>
  );
}
