import 'express-session';

declare module 'express-session' {
  interface SessionData {
    authenticated?: boolean;
    username?: string;
    isAdmin?: boolean;
  }
}

declare global {
  namespace Express {
    interface Request {
      kosyncUser?: string;
    }
  }
}

export {};
