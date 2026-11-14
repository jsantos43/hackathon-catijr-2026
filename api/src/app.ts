import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import handleError from './middlewares/handleError.js';
import handleNotFound from './middlewares/handleNotFound.js';
import routes from './routes/index.js';

export const app = express();

app.use(helmet());
// credentials: true para o navegador mandar os cookies de autenticação.
app.use(cors({ origin: env.CORS_ORIGIN.split(','), credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

routes(app);

app.use(handleNotFound);
app.use(handleError);
