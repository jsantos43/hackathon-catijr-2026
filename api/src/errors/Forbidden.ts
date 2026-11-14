import Base, { type ErrorDetails } from './Base.js';

class Forbidden extends Base {
  constructor(details: ErrorDetails = []) {
    super("You don't have the necessary permission", 403, 'FORBIDDEN', details);
  }
}

export default Forbidden;
