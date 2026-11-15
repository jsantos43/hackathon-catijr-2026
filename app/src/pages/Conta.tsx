import { Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar, Dialog } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { sinceMonth } from '../lib/format';
import { errorMessage } from '../services/api';

const NAME_MAX = 60;

/** Minha conta: trocar o nome de exibição e excluir a conta. */
export default function Conta() {
  const { user, updateName, deleteAccount } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState(user?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!user) return null;

  const trimmed = name.trim();
  const changed = trimmed !== user.name;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!trimmed || !changed || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateName(trimmed);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível salvar o nome.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount();
      navigate('/', { replace: true });
    } catch (err) {
      setDeleteError(errorMessage(err, 'Não foi possível excluir a conta.'));
      setDeleting(false);
    }
  }

  return (
    <main className="page" style={{ maxWidth: 760 }}>
      <div className="stack">
        <span className="eyebrow">Configurações</span>
        <h1 className="page-title">Minha conta</h1>
      </div>

      <section className="panel" style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Avatar id={user.id} name={user.name} size={56} self />
        <div className="stack" style={{ gap: 2, flex: 1, minWidth: 200 }}>
          <span style={{ fontWeight: 700, fontSize: 18 }}>{user.name}</span>
          <span className="small muted">{user.email}</span>
          {user.createdAt && <span className="small muted">No Arremate desde {sinceMonth(user.createdAt)}</span>}
        </div>
        <Link to={`/comitentes/${user.id}`} className="btn btn-secondary">
          Ver perfil público
        </Link>
      </section>

      <form className="panel" onSubmit={handleSave} noValidate>
        <span style={{ fontWeight: 700 }}>Nome de exibição</span>
        <span className="small muted">
          Aparece no seu perfil público. Na sala de leilão mostramos só o primeiro nome e a inicial do sobrenome.
        </span>
        <div className="field">
          <label htmlFor="conta-nome" className="sr-only">
            Nome de exibição
          </label>
          <input
            id="conta-nome"
            className="input"
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
          />
          <span className="counter">
            {name.length} / {NAME_MAX}
          </span>
        </div>
        {error && (
          <div className="alert alert-danger" role="alert">
            {error}
          </div>
        )}
        {saved && (
          <div className="alert alert-success" role="status">
            Nome atualizado.
          </div>
        )}
        <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={!trimmed || !changed || saving}>
          {saving && <span className="spinner" aria-hidden />}
          Salvar nome
        </button>
      </form>

      <section className="panel" style={{ borderColor: 'var(--danger-border)' }}>
        <span style={{ fontWeight: 700, color: 'var(--danger-text)' }}>Excluir conta</span>
        <span className="small muted">
          Seus dados pessoais saem do sistema e você não consegue mais entrar com este e-mail. Leilões, lances e
          compras continuam no histórico, em nome de “Conta excluída”, porque outras pessoas participaram deles.
          Só é possível excluir sem leilões seus agendados ou em andamento e sem estar liderando uma disputa.
        </span>
        {deleteError && (
          <div className="alert alert-danger" role="alert">
            {deleteError}
          </div>
        )}
        <button
          type="button"
          className="btn btn-danger"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => {
            setConfirmText('');
            setConfirming(true);
          }}
        >
          <Trash2 size={16} aria-hidden /> Excluir minha conta
        </button>
      </section>

      {confirming && (
        <Dialog title="Excluir sua conta?" onClose={() => setConfirming(false)}>
          <p className="muted">Não dá para desfazer. Digite EXCLUIR para confirmar.</p>
          <div className="field">
            <label htmlFor="conta-confirma" className="sr-only">
              Digite EXCLUIR
            </label>
            <input
              id="conta-confirma"
              className="input"
              value={confirmText}
              autoComplete="off"
              onChange={(e) => setConfirmText(e.target.value)}
            />
          </div>
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={confirmText.trim().toUpperCase() !== 'EXCLUIR' || deleting}
              onClick={async () => {
                setConfirming(false);
                await handleDelete();
              }}
            >
              {deleting && <span className="spinner" aria-hidden />}
              Excluir conta
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
