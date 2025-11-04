import { SessionIdPayload, UserClaim } from '../types';
import { Provider } from '../decorators';
import { ProviderScope } from '../metadata';

// TODO: REFACTOR/PROVIDERS - move to core and keep SessionInterface and SessionToken for DI

@Provider({
  name: 'SessionProvider',
  description: 'Used to store session information',
  scope: ProviderScope.SESSION,
})
export class SessionProvider {
  token: string;
  user: UserClaim;
  session?: { id: string; payload: SessionIdPayload; } | undefined;
  sessionId: string;
  sessionIdPayload: SessionIdPayload;

  requestId: string | number;

  setRequestId(requestId: string | number) {
    this.requestId = requestId;
  }
}
