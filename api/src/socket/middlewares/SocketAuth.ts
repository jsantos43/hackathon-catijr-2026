import { parseCookie } from 'cookie';
import Auth from '../../services/Auth.js';
import SessionCache from '../../services/SessionCache.js';
import type { IoSocket } from '../types.js';

/**
 * Autenticação do Socket.IO. Usa o mesmo cookie httpOnly `accessToken` da API REST: o
 * navegador manda os cookies no handshake quando o cliente usa `withCredentials: true`.
 */
class SocketAuth {
  /** Middleware do handshake (io.use). Recusa a conexão com o erro `UNAUTHORIZED`. */
  static async handshake(socket: IoSocket, next: (err?: Error) => void) {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
      const { user, sessionVersion } = await Auth.authenticate(cookies['accessToken']);

      socket.data.user = user;
      socket.data.sessionVersion = sessionVersion;
      await SessionCache.warm(user.id, sessionVersion);
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  }

  /**
   * A conexão pode durar mais que o access token. Antes de aceitar um lance, confere se a
   * sessão ainda vale (quem fez logout ou excluiu a conta não dá mais lance por um socket
   * que ficou aberto).
   */
  static async isSessionValid(socket: IoSocket) {
    const { user, sessionVersion } = socket.data;
    if (!user) return false;
    // Redis primeiro: durante a disputa o lance não vai ao PostgreSQL.
    return SessionCache.isValid(user.id, sessionVersion);
  }
}

export default SocketAuth;
