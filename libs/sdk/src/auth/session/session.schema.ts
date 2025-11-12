import { z } from 'zod';
import { TransparentSession } from './record/session.transparent';
import { StatefulSession } from './record/session.stateful';
import { StatelessSession } from './record/session.stateless';

export const SessionSchema = z.union([
  z.instanceof(TransparentSession),
  z.instanceof(StatefulSession),
  z.instanceof(StatelessSession),
]);
