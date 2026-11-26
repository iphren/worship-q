import type { RemoteConnection } from './connection';

/**
 * What the phone screens read and act through, for one workspace (native apps plan, "One set
 * of phone screens over a workspace source"; N19). `RemoteConnection` is the remote-control
 * implementation, over the venue network or the relay. The operator implementation, over the
 * device's own copy of the workspace, comes with operator access (plan M4).
 */
export type WorkspaceSource = Pick<
  RemoteConnection,
  // The connection and approval: state, start and stop, the phone's name.
  | 'state'
  | 'subscribe'
  | 'start'
  | 'stop'
  | 'connected'
  | 'via'
  | 'name'
  // The live run sheet and slide.
  | 'send'
  | 'search'
  | 'thumbnail'
  | 'fileUrl'
  | 'viewReceivedAt'
  // Bible passages.
  | 'bibleVersions'
  | 'bibleToc'
  | 'biblePassage'
  | 'bibleSearch'
  | 'setBibleVersions'
  // OBS, when a desktop of the workspace is linked to it.
  | 'obsCommand'
  | 'obsWatch'
  | 'obsImage'
  | 'subscribeImage'
  // Listening to live audio.
  | 'sendAudio'
  | 'onAudioSignal'
  | 'onRejoin'
  | 'leave'
>;
