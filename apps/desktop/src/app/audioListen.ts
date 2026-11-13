/**
 * **Listen** on this desktop (live audio plan A5, A11; task breakdown M3.2, M3.5, M3.6): a
 * plain `<audio>` element in the main window, playing on the Monitor device, kept connected
 * to whoever broadcasts by `Listener`.
 *
 * The press unlocks the device ids (`getUserMedia`, stopped at once), finds the Monitor
 * device by id then by name, and sets it from the native script call, which macOS counts as
 * a gesture even when the press's own has lapsed (L6); then it asks the broadcaster. Changing
 * the Monitor device while listening moves the element the same way, and **Listen** stays
 * on. A device that is missing, or unplugged while listening, means the system default.
 */
import {
  ListenPlayer,
  browserAudioOutput,
  browserListenPeer,
  type BrowserAudioOutput,
  type Clock,
  type ListenPeer,
  type ListenPeerEvents,
  type ListenState,
} from '@worship-q/audio';
import type { IceServer } from '@worship-q/protocol';
import type { AudioShare } from './audioShare';
import { findDevice, pickableDevices, type AudioDevice } from './deviceSettings';

declare global {
  /** Called by the native core's script call, which macOS counts as a gesture (L6). */
  var __worshipQMonitor: ((id: string) => Promise<void>) | undefined;
}

export type AudioListenState = ListenState;

/** The media calls **Listen** makes; the browser's `navigator.mediaDevices` in the app. */
export type ListenMedia = Pick<MediaDevices, 'getUserMedia' | 'enumerateDevices'> &
  Partial<Pick<MediaDevices, 'addEventListener' | 'removeEventListener'>>;

export interface AudioListenDeps {
  share: Pick<AudioShare, 'view' | 'subscribe' | 'listenerLink'>;
  iceServers: () => Promise<IceServer[]>;
  /** The Monitor device chosen in Settings; null for the system default. */
  monitor: () => AudioDevice | null;
  /** Runs `__worshipQMonitor(id)` from the native core, as a gesture (L6). */
  applySink: (id: string) => Promise<void>;
  media?: ListenMedia;
  /** The element the sound plays into, and the connection; the browser's in the app. */
  output?: BrowserAudioOutput;
  createPeer?: (args: {
    iceServers: IceServer[];
    events: ListenPeerEvents<MediaStream>;
  }) => ListenPeer;
  clock?: Clock;
}

/**
 * The order on a press (§3.8): unlock the device ids, find and set the Monitor device, then
 * ask. Returns the sink id used; empty for the system default.
 */
export async function prepareMonitor(
  media: Pick<MediaDevices, 'getUserMedia' | 'enumerateDevices'> | undefined,
  chosen: AudioDevice | null,
  apply: (id: string) => Promise<void>,
): Promise<string> {
  if (media) {
    try {
      const stream = await media.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
    } catch {
      // Without permission the names are missing; the saved id may still be found.
    }
  }
  let id = '';
  if (chosen && media) {
    const devices = await media.enumerateDevices().catch(() => []);
    id = findDevice(pickableDevices(devices, 'audiooutput'), chosen)?.id ?? '';
  }
  await apply(id).catch(() => undefined);
  return id;
}

export class AudioListen {
  private readonly player: ListenPlayer<MediaStream>;
  private readonly output: BrowserAudioOutput;
  private sinkId = '';
  private readonly unsubscribe: () => void;
  private readonly link: ReturnType<AudioShare['listenerLink']>;
  private readonly media: ListenMedia | undefined;
  private readonly onDeviceChange = () => void this.checkSink();

  constructor(private readonly deps: AudioListenDeps) {
    this.media = deps.media ?? globalThis.navigator?.mediaDevices;
    this.output = deps.output ?? browserAudioOutput();
    globalThis.__worshipQMonitor = async (id: string) => {
      // Inside the native script call: moved at once, before the gesture can lapse.
      await this.output.setSink(id);
      this.sinkId = id;
    };
    this.link = deps.share.listenerLink((signal) => this.player.signal(signal));
    this.player = new ListenPlayer<MediaStream>({
      createPeer: deps.createPeer ?? browserListenPeer,
      send: (ownerId, signal) => this.link.send(ownerId, signal),
      iceServers: deps.iceServers,
      output: this.output,
      // The press is obeyed in this order (§3.8); a release while it runs asks nothing.
      prepare: () => this.setMonitor(),
      ...(deps.clock ? { clock: deps.clock } : {}),
    });
    this.unsubscribe = deps.share.subscribe(() => this.follow());
    this.follow();
    this.media?.addEventListener?.('devicechange', this.onDeviceChange);
  }

  get state(): AudioListenState {
    return this.player.state;
  }

  subscribe = (listener: () => void): (() => void) => this.player.subscribe(listener);

  /** **Listen** pressed. */
  start(): void {
    this.player.start();
  }

  /** **Listen** released, also while the press is still setting the Monitor device. */
  stop(): void {
    this.player.stop();
  }

  /** The Monitor device was changed in Settings: the element moves, **Listen** stays on. */
  async monitorChanged(): Promise<void> {
    if (!this.player.listening) return;
    await this.setMonitor();
  }

  dispose(): void {
    this.player.stop();
    this.unsubscribe();
    this.link.close();
    this.media?.removeEventListener?.('devicechange', this.onDeviceChange);
    this.output.remove();
    delete globalThis.__worshipQMonitor;
  }

  private async setMonitor(): Promise<void> {
    this.sinkId = await prepareMonitor(this.media, this.deps.monitor(), this.deps.applySink);
  }

  private follow(): void {
    const { state, local } = this.deps.share.view;
    // The broadcasting computer does not listen to itself.
    this.player.setBroadcast(
      state && !local
        ? {
            ownerId: state.ownerId,
            activatedAt: state.activatedAt,
            active: state.active,
            status: state.status,
          }
        : null,
    );
  }

  /** The Monitor device was unplugged: the sound moves to the system default (§3.8). */
  private async checkSink(): Promise<void> {
    if (!this.player.listening || !this.sinkId || !this.media) return;
    const devices = await this.media.enumerateDevices().catch(() => []);
    const present = pickableDevices(devices, 'audiooutput').some((d) => d.id === this.sinkId);
    if (!present) await this.deps.applySink('').catch(() => undefined);
  }
}
