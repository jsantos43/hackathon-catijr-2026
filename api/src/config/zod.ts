import { z } from 'zod';

// Mensagens padrão do Zod em português (as que os schemas não personalizam, ex.: "muito grande").
z.config(z.locales.pt());
