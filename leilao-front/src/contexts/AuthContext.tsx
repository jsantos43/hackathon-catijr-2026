import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { authService, type User } from '../services/authService';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadUser() {
      try {
        const response = await authService.getMe();

        // Temporário: confirmar estrutura do GET /user.
        const data = response as { user?: User } & Partial<User>;

        if (active) {
          setUser(data.user ?? (data.id ? data as User : null));
        }
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    }

    function handleExpiredSession() {
      setUser(null);
    }

    window.addEventListener('auth:expired', handleExpiredSession);
    loadUser();

    return () => {
      active = false;
      window.removeEventListener('auth:expired', handleExpiredSession);
    };
  }, []);

  async function login(email: string, password: string): Promise<User> {
    const response = await authService.login(email, password);
    setUser(response.user);
    return response.user;
  }

  async function logout(): Promise<void> {
    await authService.logout();
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: user !== null,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro do AuthProvider');
  }

  return context;
}