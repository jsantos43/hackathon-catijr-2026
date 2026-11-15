import { LogOut, Plus, Settings, User as UserIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { initials, shortName } from '../lib/format';
import { Logo, PageLoader } from './ui';

function AccountMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!user) return null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="avatar"
        style={{ background: 'var(--primary-tint)', color: 'var(--primary-hover)' }}
        aria-label={`Sua conta: ${shortName(user.name)}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {initials(user.name)}
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <div className="who">
            <div style={{ fontWeight: 600 }}>{user.name}</div>
            <div className="small muted">{user.email}</div>
          </div>
          <Link role="menuitem" to={`/comitentes/${user.id}`} onClick={() => setOpen(false)}>
            <span className="row" style={{ gap: 8 }}>
              <UserIcon size={16} aria-hidden /> Meu perfil público
            </span>
          </Link>
          <Link role="menuitem" to="/conta" onClick={() => setOpen(false)}>
            <span className="row" style={{ gap: 8 }}>
              <Settings size={16} aria-hidden /> Minha conta
            </span>
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={async () => {
              setOpen(false);
              await logout();
              navigate('/');
            }}
          >
            <span className="row" style={{ gap: 8 }}>
              <LogOut size={16} aria-hidden /> Sair
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

export function SiteHeader() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const next = encodeURIComponent(location.pathname + location.search);

  return (
    <header className="site-header">
      <div className="container">
        <Logo />
        <nav aria-label="Principal" className="main-nav">
          <NavLink to="/" end>
            Leilões
          </NavLink>
          <NavLink to="/comitentes" end>
            Comitentes
          </NavLink>
          {isAuthenticated && <NavLink to="/participacoes">Minhas participações</NavLink>}
          {isAuthenticated && <NavLink to="/meus-leiloes">Meus leilões</NavLink>}
        </nav>
        <div className="header-actions">
          {isAuthenticated ? (
            <>
              <Link to="/anunciar" className="btn btn-primary" style={{ height: 40 }}>
                <Plus size={16} strokeWidth={2.4} aria-hidden />
                Anunciar<span className="hide-sm"> item</span>
              </Link>
              <AccountMenu />
            </>
          ) : (
            <>
              <Link to={`/entrar?next=${next}`} className="btn btn-secondary" style={{ height: 40 }}>
                Entrar
              </Link>
              <Link to={`/entrar?modo=cadastro&next=${next}`} className="btn btn-primary" style={{ height: 40 }}>
                Criar conta
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export default function Layout() {
  return (
    <>
      <SiteHeader />
      <Outlet />
    </>
  );
}

/** Rotas que exigem login (RF04). Volta para onde estava depois de entrar. */
export function RequireAuth() {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!isAuthenticated) {
    return <Navigate to={`/entrar?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return <Outlet />;
}
