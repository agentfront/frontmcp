// auth/secure-store/index.ts (#470)

// DI providers + backend token
export { SECURE_STORE_BACKEND, createSecureStoreProviders, resolveRequestSessionId } from './secure-store.providers';

// Context extension (`this.secureStore`)
export { secureStoreContextExtension, getSecureStore, tryGetSecureStore } from './secure-store.context-extension';
