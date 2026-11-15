import Base, { type ErrorDetails } from './Base.js';

// Muitas requisições em pouco tempo (rate limit de login/cadastro).
class TooManyRequests extends Base {
  constructor(details: ErrorDetails = []) {
    super('Muitas tentativas, aguarde um instante', 429, 'TOO_MANY_REQUESTS', details);
  }
}

export default TooManyRequests;
