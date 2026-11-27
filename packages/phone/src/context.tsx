import { createContext, useContext, type ReactNode } from 'react';
import type { PhoneListen } from './audio';
import type { WorkspaceSource } from './source';

/** The workspace the screens below show, and this device's listening to it. */
export interface Phone {
  connection: WorkspaceSource;
  listen: PhoneListen;
}

const PhoneContext = createContext<Phone | null>(null);

export function PhoneProvider(props: { phone: Phone; children: ReactNode }) {
  return <PhoneContext.Provider value={props.phone}>{props.children}</PhoneContext.Provider>;
}

export function usePhone(): Phone {
  const phone = useContext(PhoneContext);
  if (!phone) throw new Error('usePhone outside PhoneProvider');
  return phone;
}
