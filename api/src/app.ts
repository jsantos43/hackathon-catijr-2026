import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import ErrorHandler from './middlewares/ErrorHandler.js';
import routes from './routes/index.js';

/**
 * A aplicação Express, sem `listen`. Fica separada do server.ts para os testes poderem usar
 * o app direto (supertest) sem abrir porta nem iniciar o job de leilões.
 */
export const app = express();

app.use(helmet());
// credentials: true para o navegador mandar os cookies de autenticação.
app.use(cors({ origin: env.CORS_ORIGIN.split(','), credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

routes(app);

app.use(ErrorHandler.notFound);
app.use(ErrorHandler.handle);
