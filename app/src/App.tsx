import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import Layout, { RequireAuth } from './components/Layout';
import Criar from './pages/Criar';
import Detalhe from './pages/Detalhe';
import Inventario from './pages/Inventario';
import Listagem from './pages/Listagem';
import Login from './pages/Login';
import MeusLeiloes from './pages/MeusLeiloes';
import NovoItem from './pages/NovoItem';
import Participacoes from './pages/Participacoes';
import Perfil from './pages/Perfil';
import Sala from './pages/Sala';

function NotFound() {
  return (
    <main className="page">
      <div className="empty">
        <span style={{ fontWeight: 600, fontSize: 18 }}>Página não encontrada</span>
        <Link to="/" className="btn btn-primary">
          Ver leilões
        </Link>
      </div>
    </main>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/entrar" element={<Login />} />

        {/* A sala tem cabeçalho próprio (indicador de conexão). */}
        <Route element={<RequireAuth />}>
          <Route path="/leiloes/:id/sala" element={<Sala />} />
        </Route>

        <Route element={<Layout />}>
          <Route path="/" element={<Listagem />} />
          <Route path="/leiloes/:id" element={<Detalhe />} />
          <Route path="/comitentes/:id" element={<Perfil />} />
          <Route element={<RequireAuth />}>
            <Route path="/anunciar" element={<Inventario />} />
            <Route path="/anunciar/novo-item" element={<NovoItem />} />
            <Route path="/anunciar/leilao" element={<Criar />} />
            <Route path="/meus-leiloes" element={<MeusLeiloes />} />
            <Route path="/participacoes" element={<Participacoes />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
