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

export function createApp(
  config: AppConfig,
  userStore: UserStore,
  bookStore: BookStore,
  thumbnailQueue: ThumbnailQueue
): express.Express {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      secret: config.password,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true },
    })
  );

  app.use('/opds', createOpdsRouter(bookStore, userStore, config.thumbnailWidths));
  app.use('/kosync', createKosyncRouter(userStore));
  app.use('/api/users', createUsersRouter(userStore, config.username));
  app.use('/', createUiRouter(bookStore, userStore, config, thumbnailQueue));

  return app;
}
