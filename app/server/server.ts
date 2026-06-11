import express from 'express';
import cookieParser from 'cookie-parser';
import { AppConfig } from './types';
import { BookStore } from './services/book-store';
import { UserStore } from './services/user-store';
import { TokenStore } from './services/token-store';
import { ThumbnailQueue } from './services/thumbnail-queue';
import { jwtAuth } from './middleware/auth';
import { createOpdsRouter } from './routes/opds';
import { createKosyncRouter } from './routes/kosync';
import { createUsersRouter } from './routes/users';
import { createUiRouter } from './routes/ui';

export function createServer(
  config: AppConfig,
  userStore: UserStore,
  bookStore: BookStore,
  thumbnailQueue: ThumbnailQueue,
  tokenStore: TokenStore,
  jwtSecret: Buffer
): express.Express {
  const server = express();

  server.use(express.json());
  server.use(express.urlencoded({ extended: false }));
  server.use(cookieParser());

  server.use('/opds', createOpdsRouter(bookStore, userStore, config.thumbnailWidths));
  server.use('/kosync', createKosyncRouter(userStore, bookStore));
  server.use('/api/users', createUsersRouter(userStore, config.username, jwtAuth(jwtSecret)));
  server.use(
    '/',
    createUiRouter(bookStore, userStore, config, thumbnailQueue, tokenStore, jwtSecret)
  );

  return server;
}
