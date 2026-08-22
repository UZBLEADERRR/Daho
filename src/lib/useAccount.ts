import { useSyncExternalStore } from 'react';
import { accountSnapshot, onAccount } from './account';
import { onAuth, session, type Session } from './auth';

/** Hisob maʼlumotlari (profil, tarif, modellar) — komponentlar uchun. */
export function useAccount() {
  return useSyncExternalStore(onAccount, accountSnapshot, accountSnapshot);
}

/** Joriy sessiya; kirilmagan boʻlsa null. */
export function useSession(): Session | null {
  return useSyncExternalStore(onAuth, session, session);
}
