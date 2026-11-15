import { ArrowRight, Check, Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ErrorState, Photo, Spinner } from '../components/ui';
import { isAvailable, itemsQuery, parseItemIds, unavailableReason } from '../lib/inventory';
import { CATEGORY_LABEL, plural } from '../lib/format';
import { errorMessage } from '../services/api';
import { itemService } from '../services/itemService';
import type { OwnItem } from '../types';

/**
 * Passo 1 do anúncio: o inventário do usuário. Escolhe um ou mais itens já cadastrados
 * (vira um lote) ou cadastra um item novo; depois segue para a página do leilão.
 */
export default function Inventario() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const relistId = params.get('relistar');

  const [items, setItems] = useState<OwnItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  // Volta de "Trocar itens" com a seleção anterior.
  const [selected, setSelected] = useState<string[]>(() => parseItemIds(params.get('itens')));

  useEffect(() => {
    if (relistId) return;
    let active = true;
    itemService
      .listOwn()
      .then((list) => active && setItems(list))
      .catch((e) => active && setError(errorMessage(e)));
    return () => {
      active = false;
    };
  }, [relistId, retry]);

  // Links antigos de relistagem (/anunciar?relistar=) vão direto para o leilão.
  if (relistId) return <Navigate to={`/anunciar/leilao?relistar=${relistId}`} replace />;

  const available = (items ?? []).filter(isAvailable);
  const unavailable = (items ?? []).filter((i) => !isAvailable(i));
  const chosen = selected.filter((id) => available.some((i) => i.id === id));

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <main className="page" style={{ paddingBottom: chosen.length ? 120 : undefined }}>
      <div className="stack">
        <span className="eyebrow">Passo 1 de 2</span>
        <h1 className="page-title">O que você vai leiloar?</h1>
        <span className="muted">
          Escolha um item do seu inventário ou cadastre um novo. Marcando mais de um, eles vão juntos num lote.
        </span>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => setRetry((r) => r + 1)} />
      ) : items === null ? (
        <Spinner label="Carregando seu inventário…" />
      ) : (
        <>
          <section className="stack" style={{ gap: 14 }} aria-labelledby="inv-disp">
            <h2 id="inv-disp" style={{ fontSize: 20 }}>
              Seu inventário{' '}
              <span className="muted small" style={{ fontWeight: 500 }}>
                · {plural(available.length, 'item disponível', 'itens disponíveis')}
              </span>
            </h2>
            <div className="inv-grid">
              <Link to="/anunciar/novo-item" className="inv-card inv-new">
                <span className="inv-new-icon">
                  <Plus size={26} aria-hidden />
                </span>
                <span style={{ fontWeight: 700, fontSize: 17 }}>Cadastrar item novo</span>
                <span className="small muted">Nome, categoria, descrição e de 3 a 8 fotos.</span>
              </Link>

              {available.map((i) => {
                const on = chosen.includes(i.id);
                const order = chosen.indexOf(i.id);
                return (
                  <div key={i.id} className="inv-wrap">
                  <button type="button" className="inv-card" aria-pressed={on} onClick={() => toggle(i.id)}>
                    <span className="inv-photo">
                      <Photo src={i.images[0]} alt="" />
                      <span className="inv-check" aria-hidden>
                        {on && <Check size={16} strokeWidth={3} />}
                      </span>
                      {on && chosen.length > 1 && order === 0 && <span className="badge tag inv-cover">Capa</span>}
                    </span>
                    <span className="inv-body">
                      <span className="eyebrow">{CATEGORY_LABEL[i.category]}</span>
                      <span className="inv-name">{i.name}</span>
                      <span className="small muted">
                        {i.auctions.length ? plural(i.auctions.length, 'leilão anterior', 'leilões anteriores') : 'Nunca leiloado'}
                      </span>
                    </span>
                  </button>
                  <EditLink item={i} />
                  </div>
                );
              })}
            </div>
            {available.length === 0 && (
              <span className="small muted">Nenhum item disponível ainda — comece cadastrando um.</span>
            )}
          </section>

          {unavailable.length > 0 && (
            <section className="stack" style={{ gap: 14 }} aria-labelledby="inv-indisp">
              <h2 id="inv-indisp" style={{ fontSize: 17 }} className="muted">
                Indisponíveis para um leilão novo
              </h2>
              <div className="inv-grid">
                {unavailable.map((i) => (
                  <div key={i.id} className="inv-wrap">
                  <div className="inv-card" data-disabled="true">
                    <span className="inv-photo">
                      <Photo src={i.images[0]} alt="" />
                      <span className="badge inv-reason">{unavailableReason(i)}</span>
                    </span>
                    <span className="inv-body">
                      <span className="eyebrow">{CATEGORY_LABEL[i.category]}</span>
                      <span className="inv-name">{i.name}</span>
                    </span>
                  </div>
                  <EditLink item={i} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {chosen.length > 0 && (
        <div className="inv-bar" role="region" aria-label="Itens escolhidos">
          <div className="inv-bar-inner">
            <span style={{ fontWeight: 600 }}>
              {chosen.length === 1
                ? available.find((i) => i.id === chosen[0])?.name
                : `${chosen.length} itens no lote`}
            </span>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setSelected([])}>
                Limpar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate(`/anunciar/leilao?${itemsQuery(chosen)}`)}
              >
                Continuar <ArrowRight size={18} aria-hidden />
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/** Atalho para editar o item (nome, descrição, fotos e capa). Fica fora do botão de seleção. */
function EditLink({ item }: { item: OwnItem }) {
  return (
    <Link
      to={`/itens/${item.id}/editar?voltar=/anunciar`}
      className="inv-edit"
      aria-label={`Editar ${item.name}`}
      title="Editar item"
    >
      <Pencil size={15} aria-hidden />
    </Link>
  );
}
