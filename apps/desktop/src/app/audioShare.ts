/**
 * The workspace's live audio on this desktop (live audio plan §3, §4; task breakdown M2.8,
 * M3.2, M4.1, M5.6): broadcasting this computer's input when its switch is on, sharing the
 * audio state with the workspace, and carrying the signals that set up each listener's
 * connection.
 *
 * With the switch on, this computer owns the audio state whatever its role (A3): it captures
 * its input from the moment the workspace opens (A15), publishes the state to the
 * coordinator, and answers listeners. Otherwise it shows the state the coordinator passes on,
 * and its own **Listen** and its phones' send their signals to the broadcaster. When this
 * desktop is the coordinator it also forwards for everyone (`AudioHub`), and its own messages
 * take the same paths without the relay. Capture and the level meter work without a church
 * connection, and without a server new enough to share them (§3.1).
 */
import {
  AudioHub,
  EVERY_SESSION,
  newerAudioState,
  type AudioDown,
  type AudioOut,
  type AudioUp,
} from '@worship-q/live-state';
import {
  AUDIO_CLOSE,
  type AudioListener,
  type AudioPhone,
  type AudioSignal,
  type AudioState,
  type IceServer,
  type RemoteAudioView,
} from '@worship-q/protocol';
import {
  Broadcaster,
  InputWatcher,
  type BroadcastPeer,
  type BroadcastPeerEvents,
  type CaptureTrack,
  type InputDevice,
  type InputStatus,
  type MediaPort,
} from '@worship-q/audio';
import { switchOn, type AudioSwitchStore } from './audioSettings';

/** The listener count is published at most this often; the last value is never lost. */
export const COUNT_PUBLISH_MS = 1000;

/** Where a signal from the broadcaster goes back to. */
export type AudioRoute = { kind: 'desktop'; to: string; phone?: AudioPhone } | { kind: 'admin' };

/** What the pages show. */
export interface AudioShared {
  /** The broadcast shown here: this computer's own, or another's; null when none. */
  state: AudioState | null;
  /** This computer broadcasts. */
  local: boolean;
  /** The switch is on here. */
  switchOn: boolean;
  /** This computer's input, as the sending computer shows it (with A19's `hidden`). */
  input: InputStatus;
  inputName: string | null;
  /** The operator picked an input that could not be opened; the old one carries on. */
  pickFailed: boolean;
  /** This computer's switch went off because another computer took over (A3). */
  takenOverBy: string | null;
  /** The switch is on, but the church server is too old to share it (§3.1). */
  sharingBlocked: boolean;
}

/** How the share reaches the rest of the workspace, while this desktop is part of it. */
export interface AudioTransport {
  toCoordinator(message: AudioUp): void;
  /** As coordinator, to one device. */
  toFollower(to: string, message: AudioDown): void;
  /** To the church server: a signal for an administrator (A22). */
  toServer(signal: AudioSignal): void;
  /**
   * Whether audio messages may go out: the server speaks protocol 7 and, when another
   * desktop coordinates, that one takes them.
   */
  sharing(): boolean;
  /** Whether the server speaks protocol 7; false means Settings asks for an update. */
  serverSupports(): boolean;
  /** A connected device's name, for the listener a signal is about. */
  nameOf(deviceId: string): string;
}

/** The phones connected to this desktop (`RemoteHost`). */
export interface AudioPhones {
  /** The audio part of the phones' view changed. */
  changed(): void;
  /** A signal for one phone, by its grant. */
  deliver(grantId: string, signal: AudioSignal): void;
}

export interface AudioShareDeps {
  deviceId: () => string;
  deviceName: () => string;
  /** The input chosen in Settings; null for the system default. */
  chosenInput: () => InputDevice | null;
  /** The chosen input was found under another id: saved again. */
  inputMoved?: (device: InputDevice) => void;
  media: MediaPort<CaptureTrack>;
  createPeer: (args: {
    track: CaptureTrack | null;
    iceServers: IceServer[];
    events: BroadcastPeerEvents;
  }) => BroadcastPeer<CaptureTrack>;
  iceServers: () => Promise<IceServer[]>;
  /** Holds the system's display-sleep assertion while the switch is on (M2.5). */
  keepAwake?: (on: boolean) => void;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

type Role = 'alone' | 'coordinator' | 'follower';

export class AudioShare {
  private store: AudioSwitchStore | null = null;
  private transport: AudioTransport | null = null;
  private phones: AudioPhones | null = null;
  private role: Role = 'alone';
  private hub: AudioHub | null = null;
  private coordinatorId: string | null = null;
  /** Another device's state, as the coordinator passed it on. */
  private remote: AudioState | null = null;
  /** The newest activation seen from anyone, so a press here always wins (§3.1). */
  private newestSeen: string | null = null;
  private published: AudioState | null = null;
  private publishedKey = '';
  private revision = 0;
  private countTimer: unknown = null;
  private lastCountAt = -Infinity;
  private takenOverBy: string | null = null;
  private readonly input: InputWatcher<CaptureTrack>;
  private broadcaster: Broadcaster<AudioRoute, CaptureTrack> | null = null;
  private listeners_ = 0;
  /** Sessions this desktop's phones opened with another broadcaster, by grant. */
  private readonly phoneSessions = new Map<string, Map<string, string>>();
  private listenerSignal: ((signal: AudioSignal) => void) | null = null;
  private view_: AudioShared;
  private readonly subscribers = new Set<() => void>();
  private readonly now: () => number;
  private readonly later: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  constructor(private readonly deps: AudioShareDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.later = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = deps.clearTimeout ?? ((handle) => clearTimeout(handle as number));
    this.input = new InputWatcher<CaptureTrack>({
      port: deps.media,
      onTrack: (track) => void this.broadcaster?.setTrack(track),
      onChange: () => {
        this.publish(false);
        this.refresh();
      },
      onDeviceMoved: (device) => deps.inputMoved?.(device),
      clock: {
        now: this.now,
        setTimeout: this.later,
        clearTimeout: this.cancel,
      },
    });
    this.view_ = this.compute();
  }

  get view(): AudioShared {
    return this.view_;
  }

  /** The capture track, for the level meter; null while none. */
  get track(): CaptureTrack | null {
    return this.input.track;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  };

  private get self(): string {
    return this.deps.deviceId();
  }

  private switchIsOn(): boolean {
    return this.store?.get().broadcast === true;
  }

  // ── The switch ───────────────────────────────────────────────────────────

  /** The workspace opened here: its switch is read, and capture starts when it is on (A15). */
  start(store: AudioSwitchStore): void {
    this.store = store;
    this.applySwitch();
  }

  /** The workspace closes, or the app quits: capture stops, the switch stays as it is. */
  stop(): void {
    this.attach(null);
    this.stopBroadcasting(false);
    this.store = null;
    this.refresh();
  }

  /** **Broadcast live audio** pressed in Settings. */
  setSwitch(on: boolean): void {
    if (!this.store) return;
    if (on) {
      this.takenOverBy = null;
      this.store.set(switchOn(this.now(), this.newestSeen));
    } else {
      this.store.set({ ...this.store.get(), broadcast: false });
    }
    this.applySwitch();
    // Pressing it again after a refusal asks the system again.
    if (on) this.input.setEnabled(true, this.deps.chosenInput());
  }

  /** The operator picked another input in Settings. */
  inputChosen(device: InputDevice | null): void {
    this.input.choose(device);
  }

  /** `devicechange` in the main window. */
  devicesChanged(): void {
    this.input.devicesChanged();
  }

  /** `visibilitychange` in the main window (A19). */
  visibilityChanged(): void {
    this.input.visibilityChanged();
  }

  private applySwitch(): void {
    const on = this.switchIsOn();
    if (on && !this.broadcaster) {
      this.broadcaster = new Broadcaster<AudioRoute, CaptureTrack>({
        createPeer: this.deps.createPeer,
        iceServers: this.deps.iceServers,
        send: (route, signal) => this.fromBroadcaster(route, signal),
        onCount: (count) => this.countChanged(count),
        clock: { now: this.now, setTimeout: this.later, clearTimeout: this.cancel },
      });
      void this.broadcaster.setTrack(this.input.track);
      this.deps.keepAwake?.(true);
      this.input.setEnabled(true, this.deps.chosenInput());
      this.publish(true);
    } else if (!on && this.broadcaster) {
      this.stopBroadcasting(true);
    }
    this.refresh();
  }

  /** Stops capture and every connection; tells the workspace when `announce`. */
  private stopBroadcasting(announce: boolean): void {
    const broadcaster = this.broadcaster;
    if (!broadcaster) return;
    this.broadcaster = null;
    broadcaster.stop();
    this.input.setEnabled(false, this.deps.chosenInput());
    this.deps.keepAwake?.(false);
    this.listeners_ = 0;
    if (this.countTimer !== null) this.cancel(this.countTimer);
    this.countTimer = null;
    if (announce && this.published?.active) {
      this.revision++;
      this.published = { ...this.published, active: false, revision: this.revision, listeners: 0 };
      this.publishedKey = '';
      this.up({ type: 'audioState', state: this.published });
    }
  }

  // ── Roles, from the live link ────────────────────────────────────────────

  /** The live link connects this desktop to the workspace (or no longer does). */
  attach(transport: AudioTransport | null): void {
    this.transport = transport;
    if (!transport) {
      this.role = 'alone';
      this.hub = null;
      this.coordinatorId = null;
      this.remote = null;
    }
    this.refresh();
  }

  setPhones(phones: AudioPhones | null): void {
    this.phones = phones;
  }

  private sharing(): boolean {
    return !!this.transport?.sharing() && !!this.self;
  }

  becomeCoordinator(audience: string[]): void {
    this.role = 'coordinator';
    this.coordinatorId = this.self;
    this.hub = new AudioHub(this.self, (id) =>
      id === this.self ? this.deps.deviceName() : (this.transport?.nameOf(id) ?? ''),
    );
    // The broadcaster sends its state again to the new coordinator.
    this.remote = null;
    this.dispatch(this.hub.setAudience(audience));
    this.publish(true);
    this.refresh();
  }

  stopCoordinating(): void {
    if (this.role !== 'coordinator') return;
    this.role = 'alone';
    this.hub = null;
    this.coordinatorId = null;
    this.remote = null;
    this.refresh();
  }

  /** Connected to a coordinator, new or the same one again: this broadcast is sent again. */
  becomeFollower(coordinatorId: string): void {
    if (this.role === 'coordinator') this.stopCoordinating();
    this.role = 'follower';
    if (this.coordinatorId !== coordinatorId) this.remote = null;
    this.coordinatorId = coordinatorId;
    this.publish(true);
    this.refresh();
  }

  /** The connection went away; what was shown stays until the next word. */
  disconnected(): void {
    if (this.role === 'coordinator') return this.refresh();
    this.role = 'alone';
    this.coordinatorId = null;
    this.refresh();
  }

  setAudience(devices: string[]): void {
    if (this.hub) this.dispatch(this.hub.setAudience(devices));
  }

  greet(deviceId: string): void {
    if (this.hub) this.dispatch(this.hub.greet(deviceId));
  }

  /** As coordinator: an audio message from another desktop. */
  fromFollower(from: string, message: AudioUp): void {
    if (this.hub && this.sharing()) this.dispatch(this.hub.receive(from, message));
  }

  /** As follower: an audio message from the coordinator. */
  fromCoordinator(message: AudioDown): void {
    if (this.role !== 'follower') return;
    this.down(message);
  }

  private dispatch(out: AudioOut[]): void {
    for (const { to, message } of out) {
      if (to === this.self) this.down(message);
      else this.transport?.toFollower(to, message);
    }
  }

  private up(message: AudioUp): void {
    if (!this.sharing()) return;
    if (this.role === 'coordinator' && this.hub)
      this.dispatch(this.hub.receive(this.self, message));
    else if (this.role === 'follower') this.transport?.toCoordinator(message);
  }

  private down(message: AudioDown): void {
    if (message.type === 'audioState') return this.takeState(message.state);
    this.signalArrived(message.from, message.listener, message.signal);
  }

  private takeState(state: AudioState | null): void {
    if (state) this.seen(state.activatedAt);
    if (state?.ownerId === this.self) {
      // This computer's own state, as the coordinator holds it.
      this.remote = null;
      return this.refresh();
    }
    const mine = this.published;
    if (this.broadcaster && mine?.active) {
      if (state?.active && newerAudioState(state, mine)) {
        // Another computer switched on later: this one goes off, silently, and stays off (A3).
        this.takenOverBy = state.ownerName;
        this.store?.set({ ...this.store.get(), broadcast: false });
        this.stopBroadcasting(false);
        this.published = null;
        this.publishedKey = '';
      } else {
        // The coordinator lacks this broadcast, or holds an older one: it is sent again.
        this.remote = null;
        this.publish(true);
        return this.refresh();
      }
    }
    this.remote = state?.active ? state : null;
    this.refresh();
  }

  private seen(activatedAt: string): void {
    if (!this.newestSeen || Date.parse(activatedAt) > Date.parse(this.newestSeen)) {
      this.newestSeen = activatedAt;
    }
  }

  // ── Publishing this computer's broadcast ─────────────────────────────────

  /** This computer's own audio state as of now; null while its switch is off. */
  ownState(): AudioState | null {
    const settings = this.store?.get();
    if (!settings?.broadcast || !settings.activatedAt || !this.self) return null;
    const input = this.input.status;
    return {
      ownerId: this.self,
      ownerName: this.deps.deviceName(),
      activatedAt: settings.activatedAt,
      revision: this.revision,
      active: true,
      // Other devices see Waiting while the window is out of view (A19).
      status: input === 'live' ? 'live' : input === 'refused' ? 'refused' : 'waiting',
      inputName: this.input.inputName,
      listeners: this.listeners_,
    };
  }

  /** Publishes this computer's state when it changed, or again on a new connection. */
  private publish(again: boolean): void {
    const state = this.ownState();
    if (!state) return;
    const key = JSON.stringify([
      state.activatedAt,
      state.status,
      state.inputName,
      state.listeners,
      state.ownerName,
    ]);
    if (!again && key === this.publishedKey && this.published) return;
    if (key !== this.publishedKey || !this.published) {
      this.revision++;
      this.publishedKey = key;
      this.published = { ...state, revision: this.revision };
      this.seen(state.activatedAt);
    }
    this.up({ type: 'audioState', state: this.published });
    this.phones?.changed();
  }

  /** Status changes go out at once; the count at most once a second, never losing the last. */
  private countChanged(count: number): void {
    this.listeners_ = count;
    const wait = this.lastCountAt + COUNT_PUBLISH_MS - this.now();
    if (wait <= 0) {
      this.lastCountAt = this.now();
      this.publish(false);
      return this.refresh();
    }
    if (this.countTimer !== null) return;
    this.countTimer = this.later(() => {
      this.countTimer = null;
      this.lastCountAt = this.now();
      this.publish(false);
      this.refresh();
    }, wait);
  }

  // ── Signals ──────────────────────────────────────────────────────────────

  /**
   * A signal arrived for this desktop. The listening end says where it belongs: this
   * computer's broadcaster, this computer's **Listen**, or one of its phones.
   */
  private signalArrived(from: string, listener: AudioListener, signal: AudioSignal): void {
    const broadcaster = this.broadcaster;
    const forBroadcaster =
      signal.kind === 'listen' ||
      signal.kind === 'answer' ||
      (signal.session === EVERY_SESSION && signal.kind === 'close') ||
      ((signal.kind === 'candidate' || signal.kind === 'close') &&
        !!broadcaster?.sessionIds.includes(signal.session));
    if (forBroadcaster) {
      const route: AudioRoute = {
        kind: 'desktop',
        to: from,
        ...(listener.kind === 'phone'
          ? { phone: { grantId: listener.grantId, name: listener.name } }
          : {}),
      };
      if (!broadcaster) {
        if (signal.kind !== 'close') {
          this.fromBroadcaster(route, {
            kind: 'close',
            session: signal.session,
            reason: AUDIO_CLOSE.notBroadcasting,
          });
        }
        return;
      }
      if (signal.session === EVERY_SESSION) {
        // A device left: its sessions and its phones' are closed now (§3.2).
        broadcaster.listenerGone((_l, each) => each.kind === 'desktop' && each.to === from);
        return;
      }
      broadcaster.signal(route, listener, signal);
      return;
    }
    if (listener.kind === 'phone') {
      if (signal.kind === 'close' || signal.kind === 'full') {
        this.phoneSessions.get(listener.grantId)?.delete(signal.session);
      }
      this.phones?.deliver(listener.grantId, signal);
      return;
    }
    this.listenerSignal?.(signal);
  }

  /** Where this computer's broadcaster sends a signal. */
  private fromBroadcaster(route: AudioRoute, signal: AudioSignal): void {
    if (route.kind === 'admin') return this.transport?.toServer(signal);
    if (route.to === this.self) {
      // A phone connected to this very desktop.
      if (route.phone) this.phones?.deliver(route.phone.grantId, signal);
      return;
    }
    this.up({
      type: 'audioSignal',
      to: route.to,
      ...(route.phone ? { phone: route.phone } : {}),
      signal,
    });
  }

  /** Sends a signal to the broadcaster, for this desktop's **Listen** or one of its phones. */
  private toBroadcaster(ownerId: string, signal: AudioSignal, phone?: AudioPhone): void {
    if (ownerId === this.self) {
      const listener: AudioListener = phone
        ? { kind: 'phone', grantId: phone.grantId, name: phone.name }
        : { kind: 'desktop', deviceId: this.self, name: this.deps.deviceName() };
      return this.signalArrived(this.self, listener, signal);
    }
    this.up({ type: 'audioSignal', to: ownerId, ...(phone ? { phone } : {}), signal });
  }

  /** This desktop's own **Listen** (`AudioListen`): its way to the broadcaster and back. */
  listenerLink(onSignal: (signal: AudioSignal) => void): {
    send(ownerId: string, signal: AudioSignal): void;
    close(): void;
  } {
    this.listenerSignal = onSignal;
    return {
      send: (ownerId, signal) => this.toBroadcaster(ownerId, signal),
      close: () => {
        if (this.listenerSignal === onSignal) this.listenerSignal = null;
      },
    };
  }

  /** A phone's signal, in its name (D25, M4.1). */
  fromPhone(phone: AudioPhone, signal: AudioSignal): void {
    const owner = this.view_.state?.active ? this.view_.state.ownerId : null;
    if (!owner) {
      if (signal.kind !== 'close') {
        this.phones?.deliver(phone.grantId, {
          kind: 'close',
          session: signal.session,
          reason: AUDIO_CLOSE.notBroadcasting,
        });
      }
      return;
    }
    if (owner !== this.self) {
      let sessions = this.phoneSessions.get(phone.grantId);
      if (!sessions) this.phoneSessions.set(phone.grantId, (sessions = new Map()));
      if (signal.kind === 'listen') sessions.set(signal.session, owner);
      if (signal.kind === 'close') sessions.delete(signal.session);
    }
    this.toBroadcaster(owner, signal, phone);
  }

  /**
   * A phone's grant was revoked (M4.2): every session of it is closed at the broadcaster,
   * whichever desktop it came by.
   */
  phoneGone(grantId: string): void {
    this.broadcaster?.listenerGone(
      (listener) => listener.kind === 'phone' && listener.grantId === grantId,
    );
    this.closePhoneSessions(grantId);
  }

  /**
   * A phone has been away from this desktop long enough (M4.2): the sessions it opened
   * through this desktop are closed. One it has since opened through another desktop is that
   * desktop's to close, so a phone that moved goes on playing (§3.9).
   */
  phoneLeft(grantId: string): void {
    this.broadcaster?.listenerGone(
      (listener, route) =>
        listener.kind === 'phone' &&
        listener.grantId === grantId &&
        route.kind === 'desktop' &&
        route.to === this.self,
    );
    this.closePhoneSessions(grantId);
  }

  /** Closes, at another computer's broadcaster, the sessions a phone opened through here. */
  private closePhoneSessions(grantId: string): void {
    const sessions = this.phoneSessions.get(grantId);
    this.phoneSessions.delete(grantId);
    for (const [session, owner] of sessions ?? []) {
      this.up({
        type: 'audioSignal',
        to: owner,
        phone: { grantId, name: '' },
        signal: { kind: 'close', session, reason: AUDIO_CLOSE.gone },
      });
    }
  }

  /**
   * An administrator's signal, through the church server (A22, M5.6). `listener` names the
   * administrator's page, the same for every session it opens, so that connecting afresh
   * counts once (A20); a server that sends none has each session counted by itself.
   */
  fromAdmin(name: string, signal: AudioSignal, listener?: string): void {
    const broadcaster = this.broadcaster;
    if (!broadcaster) {
      if (signal.kind !== 'close') {
        this.transport?.toServer({
          kind: 'close',
          session: signal.session,
          reason: AUDIO_CLOSE.notBroadcasting,
        });
      }
      return;
    }
    broadcaster.signal(
      { kind: 'admin' },
      { kind: 'admin', sessionId: listener || signal.session, name },
      signal,
    );
  }

  // ── What the pages and phones use ────────────────────────────────────────

  private compute(): AudioShared {
    const own = this.ownState();
    const on = this.switchIsOn();
    return {
      state: own ?? this.remote,
      local: own !== null,
      switchOn: on,
      input: this.input.status,
      inputName: this.input.inputName,
      pickFailed: this.input.pickFailed,
      takenOverBy: on ? null : this.takenOverBy,
      sharingBlocked: on && !!this.transport && !this.transport.serverSupports(),
    };
  }

  private refresh(): void {
    const next = this.compute();
    if (JSON.stringify(next) === JSON.stringify(this.view_)) return;
    const phonesChanged =
      JSON.stringify(this.remoteView(this.view_)) !== JSON.stringify(this.remoteView(next));
    this.view_ = next;
    for (const listener of [...this.subscribers]) listener();
    if (phonesChanged) this.phones?.changed();
  }

  /** What phones connected here are shown (M4.1): nothing about the listener count. */
  remoteView(view: AudioShared = this.view_): RemoteAudioView | null {
    const state = view.state;
    if (!state?.active) return null;
    return {
      ownerId: state.ownerId,
      ownerName: state.ownerName,
      activatedAt: state.activatedAt,
      status: state.status,
    };
  }
}
