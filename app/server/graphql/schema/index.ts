import './book';
import './library';
import './series';
import './user';
import './viewer';
import { builder } from './builder';

export const schema = builder.toSchema();
