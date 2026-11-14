import Base, { type ErrorDetails } from './Base.js';

class Conflict extends Base {
  constructor(details: ErrorDetails = []) {
    super('This resource already exists', 409, 'CONFLICT', details);
  }
}

export default Conflict;
