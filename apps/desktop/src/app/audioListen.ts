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
  DelayMeter,
  Listener,
  browserListenPeer,
  readStats,
  type DelayFigure,
  type ListenStatus,
} from '@worship-q/audio';
import type { IceServer } from '@worship-q/protocol';
import type { AudioShare } from './audioShare';
import { findDevice, pickableDevices, type AudioDevice } from './deviceSettings';

/** The statistics are read this often while listening. */
export const STATS_EVERY_MS = 2000;

declare global {
  interface Window {
    /** Called by the native core's script call, which macOS counts as a gesture (L6). */
    __worshipQMonitor?: (id: string) => Promise<void>;
  }
}

export interface AudioListenState {
  status: ListenStatus;
  delay: DelayFigure | null;
}

export interface AudioListenDeps {
  share: AudioShare;
  iceServers: () => Promise<IceServer[]>;
  /** The Monitor device chosen in Settings; null for the system default. */
  monitor: () => AudioDevice | null;
  /** Runs `window.__worshipQMonitor(id)` from the native core, as a gesture (L6). */
  applySink: (id: string) => Promise<void>;
  media?: MediaDevices;
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
  private readonly listener: Listener<MediaStream>;
  private readonly element: HTMLAudioElement;
  private readonly meter = new DelayMeter();
  private state_: AudioListenState = { status: { kind: 'off' }, delay: null };
  private readonly subscribers = new Set<() => void>();
  private statsTimer: number | undefined;
  private sinkId = '';
  private readonly unsubscribe: () => void;
  private readonly link: ReturnType<AudioShare['listenerLink']>;
  private readonly media: MediaDevices | undefined;
  private readonly onDeviceChange = () => void this.checkSink();

  constructor(private readonly deps: AudioListenDeps) {
    this.media = deps.media ?? navigator.mediaDevices;
    this.element = document.createElement('audio');
    this.element.autoplay = true;
    this.element.style.display = 'none';
    document.body.appendChild(this.element);
    type Sinkable = HTMLMediaElement & { setSinkId?(id: string): Promise<void> };
    window.__worshipQMonitor = async (id: string) => {
      // Inside the native script call: moved at once, before the gesture can lapse.
      await (this.element as Sinkable).setSinkId?.(id).catch(() => undefined);
      this.sinkId = id;
    };
    this.link = deps.share.listenerLink((signal) => this.listener.signal(signal));
    this.listener = new Listener<MediaStream>({
      createPeer: browserListenPeer,
      send: (ownerId, signal) => this.link.send(ownerId, signal),
      iceServers: deps.iceServers,
      onStream: (stream) => this.play(stream),
      onStatus: (status) => {
        this.update({ status, ...(status.kind === 'off' ? { delay: null } : {}) });
        if (status.kind === 'off') this.stopStats();
      },
    });
    this.unsubscribe = deps.share.subscribe(() => this.follow());
    this.follow();
    this.media?.addEventListener?.('devicechange', this.onDeviceChange);
  }

  get state(): AudioListenState {
    return this.state_;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  };

  /** **Listen** pressed. */
  async start(): Promise<void> {
    if (this.listener.listening) return;
    // The press blesses the element for playback before anything is awaited.
    void this.element.play().catch(() => undefined);
    this.update({ status: { kind: 'connecting' }, delay: null });
    this.sinkId = await prepareMonitor(this.media, this.deps.monitor(), this.deps.applySink);
    this.listener.start();
    this.meter.reset();
    this.startStats();
  }

  /** **Listen** released. */
  stop(): void {
    this.listener.stop();
  }

  /** The Monitor device was changed in Settings: the element moves, **Listen** stays on. */
  async monitorChanged(): Promise<void> {
    if (!this.listener.listening) return;
    this.sinkId = await prepareMonitor(this.media, this.deps.monitor(), this.deps.applySink);
  }

  /** The window came back into view: nothing to do on the desktop. */
  dispose(): void {
    this.listener.stop();
    this.unsubscribe();
    this.link.close();
    this.media?.removeEventListener?.('devicechange', this.onDeviceChange);
    this.element.remove();
    if (window.__worshipQMonitor) delete window.__worshipQMonitor;
  }

  private follow(): void {
    const { state, local } = this.deps.share.view;
    // The broadcasting computer does not listen to itself.
    this.listener.setBroadcast(
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

  private play(stream: MediaStream | null): void {
    this.element.srcObject = stream;
    if (stream) void this.element.play().catch(() => undefined);
  }

  /** The Monitor device was unplugged: the sound moves to the system default (§3.8). */
  private async checkSink(): Promise<void> {
    if (!this.listener.listening || !this.sinkId || !this.media) return;
    const devices = await this.media.enumerateDevices().catch(() => []);
    const present = pickableDevices(devices, 'audiooutput').some((d) => d.id === this.sinkId);
    if (!present) await this.deps.applySink('').catch(() => undefined);
  }

  private startStats(): void {
    this.stopStats();
    this.statsTimer = window.setInterval(() => void this.readStats(), STATS_EVERY_MS);
  }

  private stopStats(): void {
    window.clearInterval(this.statsTimer);
    this.statsTimer = undefined;
  }

  private async readStats(): Promise<void> {
    const session = this.listener.sessionId;
    if (!session) return;
    const report = await this.listener.stats().catch(() => null);
    if (!report || this.listener.sessionId !== session) return;
    const figure = this.meter.push(session, readStats(report, Date.now()));
    this.listener.reportBuffer(figure.bufferMs);
    this.update({ delay: figure });
  }

  private update(patch: Partial<AudioListenState>): void {
    this.state_ = { ...this.state_, ...patch };
    for (const listener of [...this.subscribers]) listener();
  }
}
