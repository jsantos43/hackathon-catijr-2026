import Base, { type ErrorDetails } from './Base.js';

class Forbidden extends Base {
  constructor(details: ErrorDetails = []) {
    super('Você não tem permissão para isso', 403, 'FORBIDDEN', details);
  }
}

export default Forbidden;
