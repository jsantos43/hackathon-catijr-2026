import Base, { type ErrorDetails } from './Base.js';

// Muitas requisições em pouco tempo (rate limit de login/cadastro).
class TooManyRequests extends Base {
  constructor(details: ErrorDetails = []) {
    super('Too many requests, try again in a moment', 429, 'TOO_MANY_REQUESTS', details);
  }
}

export default TooManyRequests;
