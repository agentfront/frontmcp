import { createSecureStore } from './libs/auth/src/session/secure-store.factory';
const r = await createSecureStore({ config: { sqlite: { path: '/tmp/frontmcp-ss-direct.sqlite' }, scope: 'user' }, pepper: 'x-pepper-32-bytes-minimum-aaaaaaaa' });
console.log('kind=', r.kind, 'scope=', r.scope);
await r.backend.set('u:ns', 'k', 'v');
console.log('readback=', await r.backend.get('u:ns', 'k'));
