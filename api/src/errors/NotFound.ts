import Base, { type ErrorDetails } from './Base.js';

class NotFound extends Base {
  constructor(details: ErrorDetails = []) {
    super('Item not found', 404, 'NOT_FOUND', details);
  }
}

export default NotFound;
