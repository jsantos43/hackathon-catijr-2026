import Base, { type ErrorDetails } from './Base.js';

// Pedido bem formado, mas que viola uma regra de negócio (ex.: cancelar leilão com lances).
class Unprocessable extends Base {
  constructor(details: ErrorDetails = []) {
    super('This action is not allowed right now', 422, 'UNPROCESSABLE', details);
  }
}

export default Unprocessable;
