import express from 'express';
import session from 'express-session';
import { AppConfig } from './types';
import { BookStore } from './services/book-store';
import { UserStore } from './services/user-store';
import { ThumbnailQueue } from './services/thumbnail-queue';
import { createOpdsRouter } from './routes/opds';
import { createKosyncRouter } from './routes/kosync';
import { createUsersRouter } from './routes/users';
import { createUiRouter } from './routes/ui';

export function createServer(
  config: AppConfig,
  userStore: UserStore,
  bookStore: BookStore,
  thumbnailQueue: ThumbnailQueue
): express.Express {
  const server = express();

  server.use(express.json());
  server.use(express.urlencoded({ extended: false }));
  server.use(
    session({
      secret: config.password,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true },
    })
  );

  server.use('/opds', createOpdsRouter(bookStore, userStore, config.thumbnailWidths));
  server.use('/kosync', createKosyncRouter(userStore));
  server.use('/api/users', createUsersRouter(userStore, config.username));
  server.use('/', createUiRouter(bookStore, userStore, config, thumbnailQueue));

  return server;
}
