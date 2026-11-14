export type AuthUser = {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionVersion?: number;
    }
  }
}
