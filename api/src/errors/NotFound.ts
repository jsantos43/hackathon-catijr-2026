import Base, { type ErrorDetails } from './Base.js';

class NotFound extends Base {
  constructor(details: ErrorDetails = []) {
    super('Resource not found', 404, 'NOT_FOUND', details);
  }
}

export default NotFound;
