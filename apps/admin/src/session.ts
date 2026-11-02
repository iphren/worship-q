import type { AdminMe } from '@worship-q/protocol';
import { createContext, useContext } from 'react';

/** Who is signed in and what the instance is called, for every page. */
export const SessionContext = createContext<AdminMe | null>(null);

export function useSession(): AdminMe {
  const me = useContext(SessionContext);
  if (!me) throw new Error('No session: the page is rendered outside AdminApp');
  return me;
}
