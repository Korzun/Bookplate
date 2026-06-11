declare global {
  namespace Express {
    interface Request {
      kosyncUser?: string;
      kosyncUserId?: string;
      user?: import('./services/jwt').AuthUser;
    }
  }
}

export {};
