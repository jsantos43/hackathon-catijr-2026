import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Avatar, ErrorState, Spinner } from '../components/ui';
import { plural, sinceMonth } from '../lib/format';
import { errorMessage } from '../services/api';
import { userService, type SellerResult } from '../services/userService';

/**
 * RF22: qualquer pessoa busca comitentes pelo nome de exibição (pedaço do nome, sem ligar
 * para acentos ou maiúsculas) e abre o perfil público.
 */
export default function Comitentes() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);
  const [results, setResults] = useState<SellerResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  // Debounce de 300 ms e reflete na URL (dá para compartilhar o link da busca).
  useEffect(() => {
    const t = setTimeout(() => {
      const v = search.trim();
      if (v !== q) setParams(v ? { q: v } : {}, { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [search, q, setParams]);

  useEffect(() => {
    if (!q) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults(null);
      return;
    }
    let active = true;
    setError(null);
    setResults(null);
    userService
      .search(q)
      .then((r) => active && setResults(r))
      .catch((e) => active && setError(errorMessage(e)));
    return () => {
      active = false;
    };
  }, [q, retry]);

  return (
    <main className="page" style={{ maxWidth: 860 }}>
      <div className="stack">
        <h1 className="page-title">Comitentes</h1>
        <span className="muted">Encontre quem anuncia pelo nome e veja os leilões de cada um.</span>
      </div>

      <div className="search-bar">
        <div className="search-field">
          <Search size={20} color="var(--ink-2)" aria-hidden />
          <label htmlFor="cm-busca" className="sr-only">
            Buscar comitente pelo nome
          </label>
          <input
            id="cm-busca"
            type="search"
            autoFocus
            placeholder="Buscar comitente pelo nome, ex.: marina"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {!q ? (
        <span className="small muted">Digite parte do nome. “joao” também encontra “João”.</span>
      ) : error ? (
        <ErrorState message={error} onRetry={() => setRetry((r) => r + 1)} />
      ) : results === null ? (
        <Spinner label="Buscando…" />
      ) : results.length === 0 ? (
        <div className="empty">
          <span style={{ fontWeight: 600, fontSize: 18 }}>Nenhum comitente com esse nome</span>
          <span className="small muted">Só aparecem pessoas que já anunciaram pelo menos um leilão.</span>
        </div>
      ) : (
        <section className="stack" style={{ gap: 10 }} aria-label="Resultados">
          <span className="small muted" aria-live="polite">
            {plural(results.length, 'comitente encontrado', 'comitentes encontrados')}
          </span>
          {results.map((u) => (
            <Link
              key={u.id}
              to={`/comitentes/${u.id}`}
              className="card row"
              style={{ padding: 14, gap: 14, textDecoration: 'none', color: 'var(--ink)' }}
            >
              <Avatar id={u.id} name={u.name} size={48} />
              <span className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{u.name}</span>
                <span className="small muted">No Arremate desde {sinceMonth(u.createdAt)}</span>
              </span>
              <span className="badge">{plural(u.auctionCount, 'leilão', 'leilões')}</span>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
