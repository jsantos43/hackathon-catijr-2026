import Base, { type ErrorDetails } from './Base.js';

class Unauthorized extends Base {
  constructor(details: ErrorDetails = []) {
    super('Você precisa entrar na sua conta', 401, 'UNAUTHORIZED', details);
  }
}

export default Unauthorized;
