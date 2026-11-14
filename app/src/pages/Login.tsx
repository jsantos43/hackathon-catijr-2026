import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { shortName } from '../lib/format';
import { errorMessage } from '../services/api';

type Mode = 'login' | 'cadastro';

// Só aceita caminhos internos no ?next= (evita redirecionar para outro site).
const safeNext = (raw: string | null) => (raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/');

export default function Login() {
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get('modo') === 'cadastro' ? 'cadastro' : 'login';
  const next = safeNext(params.get('next'));
  const { login, register, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  if (isAuthenticated && !sending) return <Navigate to={next} replace />;

  const setMode = (m: Mode) => {
    const p = new URLSearchParams(params);
    if (m === 'cadastro') p.set('modo', 'cadastro');
    else p.delete('modo');
    setParams(p, { replace: true });
    setError('');
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (mode === 'cadastro' && password.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.');
      return;
    }
    setSending(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register({ name: name.trim(), email: email.trim().toLowerCase(), password });
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err, mode === 'login' ? 'E-mail ou senha inválidos.' : 'Não foi possível criar a conta.'));
      setSending(false);
    }
  }

  const emailTaken = /já existe uma conta/i.test(error);

  return (
    <div className="auth-wrap">
      <div className="auth-hero">
        <Logo />
        <div className="stack" style={{ gap: 16 }}>
          <h1>Lances ao vivo. Resultado na hora.</h1>
          <p>Acompanhe leilões em tempo real, dispute itens com outras pessoas e anuncie o que você quer vender.</p>
        </div>
        <div className="demo" aria-hidden>
          <span className="badge badge-running" style={{ alignSelf: 'flex-start' }}>
            <span className="dot" />
            Ao vivo · 04:18
          </span>
          <span style={{ fontWeight: 600, fontSize: 17 }}>Vitrola Philips anos 70</span>
          <div className="row between">
            <span className="display num" style={{ fontSize: 28 }}>
              R$ 685,00
            </span>
            <span className="small" style={{ color: '#9FD6BE' }}>
              Líder: Carla M.
            </span>
          </div>
        </div>
      </div>

      <div className="auth-form-side">
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <div className="segmented" role="tablist" aria-label="Acesso">
            <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => setMode('login')}>
              Entrar
            </button>
            <button type="button" role="tab" aria-selected={mode === 'cadastro'} onClick={() => setMode('cadastro')}>
              Criar conta
            </button>
          </div>

          <div className="stack" style={{ gap: 4 }}>
            <h2 style={{ fontSize: 28 }}>{mode === 'login' ? 'Entre na sua conta' : 'Crie sua conta'}</h2>
            <span className="muted">
              {mode === 'login'
                ? 'Para dar lances e anunciar itens.'
                : 'Toda conta já pode dar lances e anunciar itens.'}
            </span>
          </div>

          {mode === 'cadastro' && (
            <div className="field">
              <label htmlFor="lg-nome">Nome de exibição</label>
              <input
                id="lg-nome"
                className="input"
                autoComplete="name"
                value={name}
                maxLength={60}
                required
                onChange={(e) => setName(e.target.value)}
              />
              <span className="hint">
                Na sala, os outros veem só "{name.trim() ? shortName(name) : 'Nome S.'}"
              </span>
            </div>
          )}

          <div className="field">
            <label htmlFor="lg-email">E-mail</label>
            <input
              id="lg-email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              required
              aria-invalid={emailTaken}
              onChange={(e) => setEmail(e.target.value)}
            />
            {emailTaken && (
              <span className="hint error">
                Já existe uma conta com este e-mail.{' '}
                <button type="button" className="btn-ghost" style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--primary)', padding: 0 }} onClick={() => setMode('login')}>
                  Entrar
                </button>
              </span>
            )}
          </div>

          <div className="field">
            <label htmlFor="lg-senha">Senha</label>
            <input
              id="lg-senha"
              className="input"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              required
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === 'cadastro' && <span className="hint">Mínimo de 8 caracteres.</span>}
          </div>

          {error && !emailTaken && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-block" disabled={sending} style={{ height: 48 }}>
            {sending && <span className="spinner" aria-hidden />}
            {sending
              ? mode === 'login'
                ? 'Entrando…'
                : 'Criando conta…'
              : mode === 'login'
                ? 'Entrar'
                : 'Criar conta e continuar'}
          </button>

          <div className="alert alert-muted small">
            A sessão dura 15 minutos e se renova sozinha enquanto você usa (até 7 dias). Se expirar no meio de um
            lance, você entra de novo e o lance não é duplicado.
          </div>
        </form>
      </div>
    </div>
  );
}
