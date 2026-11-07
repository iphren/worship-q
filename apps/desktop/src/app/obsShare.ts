/**
 * The workspace's OBS state on this desktop (OBS control plan §4; task breakdown M2.6, M2.8,
 * M2.9, M5.1): what the switch button, the OBS panel and the phones show, and where their
 * commands go.
 *
 * When this computer's OBS link is on, it owns the state: it publishes it to the coordinator,
 * answers commands forwarded from other devices, and takes live monitor images while anyone
 * watches. Otherwise it shows the state the coordinator passes on, and sends its commands
 * there. When this desktop is the coordinator, it also forwards for everyone (`ObsHub`), and
 * its own messages take the same paths without the relay.
 *
 * It works without a church connection too: the OBS computer's own controls never depend on
 * the workspace (M2.9).
 */
import {
  newerObsState,
  ObsHub,
  outputElapsed,
  switchTarget,
  type ObsDown,
  type ObsOut,
  type ObsUp,
} from '@worship-q/live-state';
import {
  OBS_ERRORS,
  type ObsCommand,
  type ObsResult,
  type ObsSnapshot,
  type ObsState,
  type RemoteObsView,
} from '@worship-q/protocol';
import type { ObsLink } from './obs';

/** A command sent to the OBS computer is given up on after this long without an answer. */
export const OBS_COMMAND_TIMEOUT_MS = 10_000;

export interface ObsShared {
  /** What the controls show; null hides them everywhere on this desktop (O5). */
  state: ObsState | null;
  /** This computer's link holds the state. */
  local: boolean;
  /** Commands can reach the OBS computer from here now. */
  reachable: boolean;
  /** When `state` was taken, on this computer's clock, for the timers. */
  receivedAt: number;
  /** This computer's link was turned off because another computer took OBS over (M3.5). */
  takenOverBy: string | null;
  /** This computer's link is on, but the church server is too old to share it (M2.9). */
  sharingBlocked: boolean;
}

/** A received live monitor image. */
export interface ObsMonitorImage extends ObsSnapshot {
  receivedAt: number;
}

/** How the share reaches the rest of the workspace, while this desktop is part of it. */
export interface ObsTransport {
  /** To the coordinator; dropped while there is none. */
  toCoordinator(message: ObsUp): void;
  /** As coordinator, to one device. */
  toFollower(to: string, message: ObsDown): void;
  /**
   * Whether OBS messages may go out: the church server speaks protocol 4 and, when another
   * desktop coordinates, that one takes them.
   */
  sharing(): boolean;
  /** Whether the server speaks protocol 4; false means Settings asks for an update (M2.9). */
  serverSupports(): boolean;
}

/** The phones connected to this desktop (`RemoteHost`). */
export interface ObsPhones {
  /** The OBS part of the phones' view changed. */
  changed(): void;
  snapshot(snapshot: ObsSnapshot): void;
}

export interface ObsShareDeps {
  deviceId: () => string;
  deviceName: () => string;
  now?: () => number;
  newId?: () => string;
}

type Role = 'alone' | 'coordinator' | 'follower';

const EMPTY: ObsShared = {
  state: null,
  local: false,
  reachable: false,
  receivedAt: 0,
  takenOverBy: null,
  sharingBlocked: false,
};

export class ObsShare {
  private link: ObsLink | null = null;
  private unsubscribeLink: (() => void) | null = null;
  private unsubscribeShots: (() => void) | null = null;
  private transport: ObsTransport | null = null;
  private phones: ObsPhones | null = null;
  private role: Role = 'alone';
  private hub: ObsHub | null = null;
  /** The coordinator followed; null while not connected to one. */
  private coordinatorId: string | null = null;
  /** Another device's state, as the coordinator passed it on. */
  private remote: ObsState | null = null;
  private remoteFrom: string | null = null;
  private remoteAt = 0;
  /** This link's state as last published, and the key it was published under. */
  private published: ObsState | null = null;
  private publishedKey = '';
  private revision = 0;
  private takenOverBy: string | null = null;
  private readonly asks = new Map<
    string,
    { resolve(result: ObsResult): void; timer: ReturnType<typeof setTimeout> }
  >();
  private watchingHere = false;
  private watchingPhones = false;
  /** What the coordinator was last told about this desktop watching. */
  private watchSent = false;
  /** Whether the coordinator says other devices watch this computer's OBS. */
  private watchedElsewhere = false;
  private image_: ObsMonitorImage | null = null;
  private view_: ObsShared = EMPTY;
  private readonly listeners = new Set<() => void>();
  private readonly imageListeners = new Set<() => void>();
  private readonly linkListeners = new Set<() => void>();
  /** Panels on this desktop showing the live monitor. */
  private hereCount = 0;
  private counter = 0;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: ObsShareDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.newId = deps.newId ?? (() => `obs-${Date.now().toString(36)}-${++this.counter}`);
  }

  get view(): ObsShared {
    return this.view_;
  }

  /** The latest live monitor image; null until one arrives while watching. */
  get image(): ObsMonitorImage | null {
    return this.image_;
  }

  /** The local OBS link, once it is started. */
  get localLink(): ObsLink | null {
    return this.link;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeImage = (listener: () => void): (() => void) => {
    this.imageListeners.add(listener);
    return () => this.imageListeners.delete(listener);
  };

  /** Called when the local link appears, or anything in it changes (Settings → OBS). */
  subscribeLink = (listener: () => void): (() => void) => {
    this.linkListeners.add(listener);
    return () => this.linkListeners.delete(listener);
  };

  private get self(): string {
    return this.deps.deviceId();
  }

  private localActive(): boolean {
    return this.link?.view.settings.active === true;
  }

  // ── Wiring ───────────────────────────────────────────────────────────────

  setLink(link: ObsLink | null): void {
    this.unsubscribeLink?.();
    this.unsubscribeShots?.();
    this.link = link;
    this.unsubscribeLink = link?.subscribe(() => this.linkChanged()) ?? null;
    this.unsubscribeShots = link?.onSnapshot((snapshot) => this.ownImage(snapshot)) ?? null;
    this.linkChanged();
    for (const listener of [...this.linkListeners]) listener();
  }

  setPhones(phones: ObsPhones | null): void {
    this.phones = phones;
  }

  /** The live link connects this desktop to the workspace (or no longer does). */
  attach(transport: ObsTransport | null): void {
    this.transport = transport;
    if (!transport) {
      this.role = 'alone';
      this.hub = null;
      this.coordinatorId = null;
      this.forgetRemote();
    }
    this.refresh();
  }

  stop(): void {
    this.attach(null);
    this.setLink(null);
    for (const ask of this.asks.values()) {
      clearTimeout(ask.timer);
      ask.resolve({ ok: false, error: OBS_ERRORS.notConnected });
    }
    this.asks.clear();
  }

  // ── Roles, from the live link ────────────────────────────────────────────

  private sharing(): boolean {
    return !!this.transport?.sharing() && !!this.self;
  }

  /** This desktop became the coordinator: it forwards for everyone (M2.3). */
  becomeCoordinator(audience: string[]): void {
    this.role = 'coordinator';
    this.coordinatorId = this.self;
    this.hub = new ObsHub(this.self);
    // The owner sends its state again to the new coordinator; until then, nothing is shown
    // rather than a state nobody will update.
    this.forgetRemote();
    this.watchSent = false;
    this.watchedElsewhere = false;
    this.link?.setWatchingElsewhere(false);
    this.dispatch(this.hub.setAudience(audience));
    this.publish(true);
    this.sendWatch();
    this.refresh();
  }

  /** This desktop stopped coordinating. */
  stopCoordinating(): void {
    if (this.role !== 'coordinator') return;
    this.role = 'alone';
    this.hub = null;
    this.coordinatorId = null;
    this.forgetRemote();
    this.refresh();
  }

  /**
   * Connected to a coordinator, a new one or the same one again: the state it holds is
   * asked for by saying this device takes OBS messages (the capabilities the live link sends
   * first); this link's state and watching are sent again.
   */
  becomeFollower(coordinatorId: string): void {
    if (this.role === 'coordinator') this.stopCoordinating();
    this.role = 'follower';
    if (this.remoteFrom !== coordinatorId) this.forgetRemote();
    this.coordinatorId = coordinatorId;
    // Watching is counted again by this coordinator.
    this.watchSent = false;
    this.watchedElsewhere = false;
    this.link?.setWatchingElsewhere(false);
    this.publish(true);
    this.sendWatch();
    this.refresh();
  }

  /**
   * The connection went away; what was shown stays, unusable. A coordinator keeps forwarding:
   * the relay gives it the role back on reconnecting, without it becoming coordinator anew,
   * and it stops only when the role goes elsewhere (`stopCoordinating`).
   */
  disconnected(): void {
    if (this.role === 'coordinator') return this.refresh();
    this.role = 'alone';
    this.coordinatorId = null;
    this.watchedElsewhere = false;
    this.link?.setWatchingElsewhere(false);
    this.refresh();
  }

  /** As coordinator: the devices that take OBS messages changed. */
  setAudience(devices: string[]): void {
    if (this.hub) this.dispatch(this.hub.setAudience(devices));
  }

  /** As coordinator: a device said it takes OBS messages, on connecting or again. */
  greet(deviceId: string): void {
    if (this.hub) this.dispatch(this.hub.greet(deviceId));
  }

  /** As coordinator: an OBS message from another desktop. */
  fromFollower(from: string, message: ObsUp): void {
    if (this.hub && this.sharing()) this.dispatch(this.hub.receive(from, message));
  }

  /** As follower: an OBS message from the coordinator. */
  fromCoordinator(message: ObsDown): void {
    if (this.role !== 'follower') return;
    void this.down(message);
  }

  private dispatch(out: ObsOut[]): void {
    for (const { to, message } of out) {
      if (to === this.self) void this.down(message);
      else this.transport?.toFollower(to, message);
    }
  }

  /** To the coordinator: through the hub when it is this desktop. */
  private up(message: ObsUp): void {
    if (!this.sharing()) return;
    if (this.role === 'coordinator' && this.hub)
      this.dispatch(this.hub.receive(this.self, message));
    else if (this.role === 'follower') this.transport?.toCoordinator(message);
  }

  private async down(message: ObsDown): Promise<void> {
    switch (message.type) {
      case 'obsState': {
        const state = message.state;
        if (state?.ownerId === this.self) {
          // This computer's own state, as the coordinator holds it: this link speaks for itself.
          this.forgetRemote();
          break;
        }
        if (
          this.localActive() &&
          this.published?.active &&
          (!state?.active || !newerObsState(state, this.published))
        ) {
          // The coordinator lacks this link's state, or holds an older activation instead: what
          // was sent before was lost, for example while it was still taking the role. Sent again.
          this.forgetRemote();
          this.publish(true);
          break;
        }
        this.remote = state;
        this.remoteFrom = this.coordinatorId;
        this.remoteAt = this.now();
        if (state?.active && this.published?.active && this.localActive()) {
          if (newerObsState(state, this.published)) {
            // Another computer activated its link later: this one turns off, silently (O9).
            this.takenOverBy = state.ownerName;
            await this.link?.deactivate();
          }
        }
        break;
      }
      case 'obsCommand': {
        const result =
          this.localActive() && this.link
            ? await this.link.command(message.command)
            : { ok: false, error: OBS_ERRORS.noObs };
        this.up({ type: 'obsAck', id: message.id, ...result });
        return;
      }
      case 'obsAck': {
        const ask = this.asks.get(message.id);
        if (!ask) return;
        clearTimeout(ask.timer);
        this.asks.delete(message.id);
        ask.resolve({
          ok: message.ok,
          ...(message.code !== undefined ? { code: message.code } : {}),
          ...(message.error !== undefined ? { error: message.error } : {}),
        });
        return;
      }
      case 'obsWatch':
        this.watchedElsewhere = message.watching;
        if (this.localActive()) this.link?.setWatchingElsewhere(message.watching);
        return;
      case 'obsSnapshot': {
        if (this.localActive()) return;
        this.showImage({ image: message.image, takenAt: message.takenAt });
        return;
      }
    }
    this.refresh();
  }

  private forgetRemote(): void {
    this.remote = null;
    this.remoteFrom = null;
  }

  // ── This computer's link ─────────────────────────────────────────────────

  private linkChanged(): void {
    const active = this.localActive();
    if (active) this.takenOverBy = null;
    // Watching moves between this link and the coordinator as the link turns on or off.
    this.link?.setWatchingHere(active && (this.watchingHere || this.watchingPhones));
    this.link?.setWatchingElsewhere(active && this.watchedElsewhere);
    this.sendWatch();
    this.publish(false);
    this.refresh();
    for (const listener of [...this.linkListeners]) listener();
  }

  /** What decides whether the state changed; the timers' own advance is left out. */
  private key(link: ObsLink): string {
    const {
      settings,
      link: status,
      ready,
      closing,
      scenes,
      currentScene,
      outputs,
      measuredAt,
    } = link.view;
    return JSON.stringify([
      settings.active,
      settings.activatedAt,
      settings.favourites,
      status.state,
      ready,
      closing,
      scenes,
      currentScene,
      outputs,
      measuredAt,
      this.deps.deviceName(),
    ]);
  }

  /**
   * This computer's own OBS state with its durations as of now, also while its link is off,
   * for the report to the church server (`ObsReporter`). Null when this computer has never
   * turned its link on, or before it joined a workspace.
   */
  ownState(): ObsState | null {
    const local = this.link?.localState();
    if (!local || !this.self) return null;
    return {
      ...local,
      ownerId: this.self,
      ownerName: this.deps.deviceName(),
      revision: this.revision,
    };
  }

  /** One image of this computer's OBS program, for the report to the church server. */
  takeSnapshot(): Promise<ObsSnapshot | null> {
    return this.link?.takeSnapshot() ?? Promise.resolve(null);
  }

  /** Publishes this link's state when it changed, or again on a new connection. */
  private publish(again: boolean): void {
    const link = this.link;
    const local = link?.localState();
    if (!link || !local || !this.self) return;
    const key = this.key(link);
    if (!again && key === this.publishedKey && this.published) return;
    if (key !== this.publishedKey || !this.published) {
      this.revision++;
      this.publishedKey = key;
      this.published = {
        ...local,
        ownerId: this.self,
        ownerName: this.deps.deviceName(),
        revision: this.revision,
      };
    }
    this.up({ type: 'obsState', state: this.published });
  }

  private ownImage(snapshot: ObsSnapshot): void {
    if (!this.localActive()) return;
    if (this.watchingHere || this.watchingPhones) this.showImage(snapshot);
    if (this.watchedElsewhere) this.up({ type: 'obsSnapshot', ...snapshot });
  }

  private showImage(snapshot: ObsSnapshot): void {
    if (!this.watchingHere && !this.watchingPhones) return;
    this.image_ = { ...snapshot, receivedAt: this.now() };
    for (const listener of [...this.imageListeners]) listener();
    if (this.watchingPhones) this.phones?.snapshot(snapshot);
  }

  // ── What the pages and phones use ────────────────────────────────────────

  private refresh(): void {
    const link = this.link;
    const local = link?.localState();
    const sharingBlocked = !!(
      this.localActive() &&
      this.transport &&
      !this.transport.serverSupports()
    );
    let next: ObsShared;
    if (link && local?.active) {
      next = {
        state: {
          ...local,
          ownerId: this.self || 'this-computer',
          ownerName: this.deps.deviceName(),
          revision: this.revision,
        },
        local: true,
        reachable: true,
        receivedAt: this.now(),
        takenOverBy: null,
        sharingBlocked,
      };
    } else if (this.remote?.active) {
      next = {
        state: this.remote,
        local: false,
        reachable: this.role !== 'alone' && this.coordinatorId !== null && this.sharing(),
        receivedAt: this.remoteAt,
        takenOverBy: this.takenOverBy,
        sharingBlocked,
      };
    } else {
      next = { ...EMPTY, takenOverBy: this.takenOverBy, sharingBlocked };
    }
    if (JSON.stringify(next) === JSON.stringify(this.view_)) return;
    this.view_ = next;
    for (const listener of [...this.listeners]) listener();
    this.phones?.changed();
  }

  /** Sends a command to OBS, wherever it is; resolves with OBS's answer. */
  command(command: ObsCommand): Promise<ObsResult> {
    if (this.localActive() && this.link) return this.link.command(command);
    if (!this.remote?.active) return Promise.resolve({ ok: false, error: OBS_ERRORS.noObs });
    if (!this.view_.reachable) {
      return Promise.resolve({ ok: false, error: OBS_ERRORS.notConnected });
    }
    const id = this.newId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.asks.delete(id);
        resolve({ ok: false, error: OBS_ERRORS.timeout });
      }, OBS_COMMAND_TIMEOUT_MS);
      this.asks.set(id, { resolve, timer });
      this.up({ type: 'obsCommand', id, command });
    });
  }

  /**
   * Switches to the other favourite scene (O4). Decided here from what this desktop shows,
   * and sent as the scene wanted, so two presses at once land on the same scene.
   */
  switchScene(): Promise<ObsResult> {
    const target = this.view_.state ? switchTarget(this.view_.state) : null;
    if (!target) return Promise.resolve({ ok: false, error: OBS_ERRORS.noObs });
    return this.command({ type: 'setScene', scene: target });
  }

  /** A panel on this desktop shows the live monitor, or stopped showing it. */
  setWatchingHere(watching: boolean): void {
    this.watchingHere = watching;
    this.watchChanged();
  }

  /** A panel starts showing the live monitor; the returned function stops it. */
  watchHere(): () => void {
    this.hereCount++;
    this.setWatchingHere(true);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.hereCount--;
      if (this.hereCount === 0) this.setWatchingHere(false);
    };
  }

  /** Any phone connected here shows the live monitor (M4.2, M5.1). */
  setWatchingPhones(watching: boolean): void {
    this.watchingPhones = watching;
    this.watchChanged();
  }

  private watchChanged(): void {
    if (!this.watchingHere && !this.watchingPhones) this.image_ = null;
    this.link?.setWatchingHere(this.localActive() && (this.watchingHere || this.watchingPhones));
    this.sendWatch();
  }

  /** Tells the coordinator whether this desktop wants images from another computer's OBS. */
  private sendWatch(): void {
    const wanted = !this.localActive() && (this.watchingHere || this.watchingPhones);
    if (wanted === this.watchSent || this.role === 'alone') return;
    this.watchSent = wanted;
    this.up({ type: 'obsWatch', watching: wanted });
  }

  /** What phones connected here are shown (M2.8). */
  remoteView(): RemoteObsView | null {
    const { state, reachable, receivedAt } = this.view_;
    if (!state) return null;
    const now = this.now();
    const carried = (output: ObsState['stream']) => ({
      ...output,
      durationMs: outputElapsed(output, receivedAt, now),
    });
    return {
      status: state.status,
      ownerName: state.ownerName,
      reachable,
      scenes: state.scenes,
      currentScene: state.currentScene,
      favourites: state.favourites,
      stream: carried(state.stream),
      record: carried(state.record),
      virtualCam: carried(state.virtualCam),
    };
  }
}

/** Gives the phones connected to this desktop its OBS view, commands and images (M2.8). */
export function shareObsWithPhones(
  share: ObsShare,
  host: {
    setObs(obs: {
      view(): RemoteObsView | null;
      command(command: ObsCommand): Promise<ObsResult>;
      watching(watching: boolean): void;
    }): void;
    obsChanged(): void;
    obsSnapshot(snapshot: ObsSnapshot): void;
  },
): void {
  host.setObs({
    view: () => share.remoteView(),
    command: (command) => share.command(command),
    watching: (watching) => share.setWatchingPhones(watching),
  });
  share.setPhones({
    changed: () => host.obsChanged(),
    snapshot: (snapshot) => host.obsSnapshot(snapshot),
  });
}
