/**
 * A phone's screens and connection for remote control, shared by the phone page served by
 * church servers (`apps/remote`) and the phone and tablet app (native apps plan M2.5).
 */
export { PhoneListen } from './audio';
export {
  RemoteConnection,
  type PhoneLink,
  type PhoneSocket,
  type PhoneStore,
  type RemoteState,
} from './connection';
export { PhoneProvider, usePhone, type Phone } from './context';
export { PhoneApp } from './PhoneApp';
export type { WorkspaceSource } from './source';
