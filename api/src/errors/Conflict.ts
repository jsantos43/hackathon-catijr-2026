import Base, { type ErrorDetails } from './Base.js';

class Conflict extends Base {
  constructor(details: ErrorDetails = []) {
    super('Esse registro já existe', 409, 'CONFLICT', details);
  }
}

export default Conflict;
