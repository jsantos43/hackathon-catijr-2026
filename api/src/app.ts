import './config/zod.js';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import ErrorHandler from './middlewares/ErrorHandler.js';
import routes from './routes/index.js';
import { UPLOADS_ROOT } from './utils/storage.js';

/**
 * A aplicação Express, sem `listen`. Fica separada do server.ts para os testes poderem usar
 * o app direto (supertest) sem abrir porta nem iniciar o job de leilões.
 */
export const app = express();

// Atrás do nginx: req.ip passa a ser o IP real do cliente (rate limit de login por IP) e
// req.secure reflete o protocolo real (X-Forwarded-Proto), usado no atributo `secure` dos cookies.
app.set('trust proxy', env.TRUST_PROXY);

// Fotos. Em produção o nginx responde /uploads antes de chegar aqui; em dev, a API serve.
// Cross-Origin-Resource-Policy: o front (outra origem em dev) precisa conseguir exibir.
app.use(
  '/uploads',
  (_req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  },
  express.static(UPLOADS_ROOT, { immutable: true, maxAge: '365d', index: false, dotfiles: 'ignore' }),
);

app.use(helmet());
// credentials: true para o navegador mandar os cookies de autenticação.
app.use(cors({ origin: env.CORS_ORIGIN.split(','), credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

routes(app);

app.use(ErrorHandler.notFound);
app.use(ErrorHandler.handle);
