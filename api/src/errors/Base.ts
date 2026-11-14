import type { Response } from 'express';

export type ErrorDetails = string | string[];

class Base extends Error {
  status: number;
  code: string;
  details: string[];

  constructor(
    message = 'Internal server error',
    status = 500,
    code = 'INTERNAL_ERROR',
    details: ErrorDetails = [],
  ) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = typeof details === 'string' ? [details] : details;
  }

  send(res: Response) {
    return res.status(this.status).send({
      success: false,
      error: this.code,
      message: this.message,
      details: this.details,
    });
  }
}

export default Base;
