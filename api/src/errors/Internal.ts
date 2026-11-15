import Base, { type ErrorDetails } from './Base.js';

class Internal extends Base {
  constructor(details: ErrorDetails = []) {
    super('Erro interno do servidor', 500, 'INTERNAL_ERROR', details);
  }
}

export default Internal;
