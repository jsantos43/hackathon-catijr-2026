import Base, { type ErrorDetails } from './Base.js';

class NotFound extends Base {
  constructor(details: ErrorDetails = []) {
    super('Não encontrado', 404, 'NOT_FOUND', details);
  }
}

export default NotFound;
