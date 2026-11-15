import Base, { type ErrorDetails } from './Base.js';

class InvalidRequest extends Base {
  constructor(details: ErrorDetails = []) {
    super('Dados inválidos', 400, 'INVALID_REQUEST', details);
  }
}

export default InvalidRequest;
