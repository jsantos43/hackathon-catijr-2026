import Base, { type ErrorDetails } from './Base.js';

class Unauthorized extends Base {
  constructor(details: ErrorDetails = []) {
    super("You aren't authorized", 401, 'UNAUTHORIZED', details);
  }
}

export default Unauthorized;
