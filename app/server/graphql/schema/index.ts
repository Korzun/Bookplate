import './book';
import './config';
import './device';
import './library';
import './pending-fix';
import './progress';
import './series';
import './user';
import './validation';
import './viewer';
import { builder } from './builder';

export const schema = builder.toSchema();
