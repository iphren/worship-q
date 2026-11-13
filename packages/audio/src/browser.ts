/**
 * The thin layer over the browser's WebRTC and media calls, shared by the desktop, the phone
 * page and the admin page. It decides nothing: `Broadcaster`, `Listener` and `InputWatcher`
 * do. It has no automated tests; the walkthrough's manual checks cover it (§3.13).
 */
import type { AudioCandidate, IceServer } from '@worship-q/protocol';
import type { BroadcastPeer, BroadcastPeerEvents } from './broadcaster';
import type { CaptureTrack, InputDevice, MediaPort } from './input';
import type { ListenPeer, ListenPeerEvents } from './listener';
import type { PeerState } from './timers';

/** The capture constraints the spike settled on: no voice processing, mono (plan §4). */
export const CAPTURE_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
} as const;

function candidateOf(event: RTCPeerConnectionIceEvent): AudioCandidate | null {
  // The end of candidates is passed on as an empty line.
  const candidate = event.candidate;
  if (!candidate) return { candidate: '', sdpMid: null, sdpMLineIndex: null };
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
  };
}

function watchState(connection: RTCPeerConnection, state: (state: PeerState) => void): void {
  connection.onconnectionstatechange = () => state(connection.connectionState as PeerState);
}

/** A send-only connection carrying the capture track (M2.7). */
export function browserBroadcastPeer(args: {
  track: BrowserTrack | null;
  iceServers: IceServer[];
  events: BroadcastPeerEvents;
}): BroadcastPeer<BrowserTrack | CaptureTrack> {
  const connection = new RTCPeerConnection({ iceServers: args.iceServers as RTCIceServer[] });
  const transceiver = connection.addTransceiver('audio', { direction: 'sendonly' });
  if (args.track) void transceiver.sender.replaceTrack(args.track.track);
  connection.onicecandidate = (event) => {
    const candidate = candidateOf(event);
    if (candidate) args.events.candidate(candidate);
  };
  watchState(connection, args.events.state);
  return {
    async offer(restart) {
      const offer = await connection.createOffer(restart ? { iceRestart: true } : undefined);
      await connection.setLocalDescription(offer);
      return connection.localDescription?.sdp ?? offer.sdp ?? '';
    },
    async answer(sdp) {
      await connection.setRemoteDescription({ type: 'answer', sdp });
    },
    async addCandidate(candidate) {
      await connection.addIceCandidate(candidate.candidate === '' ? null : candidate);
    },
    async setTrack(track) {
      // Only `browserMediaPort`'s tracks are ever given here.
      await transceiver.sender.replaceTrack((track as BrowserTrack | null)?.track ?? null);
    },
    close() {
      connection.onconnectionstatechange = null;
      connection.onicecandidate = null;
      connection.close();
    },
  };
}

/** A receive-only connection, playing what arrives (M3.2, M4.4, M5.8). */
export function browserListenPeer(args: {
  iceServers: IceServer[];
  events: ListenPeerEvents<MediaStream>;
}): ListenPeer {
  const connection = new RTCPeerConnection({ iceServers: args.iceServers as RTCIceServer[] });
  connection.onicecandidate = (event) => {
    const candidate = candidateOf(event);
    if (candidate) args.events.candidate(candidate);
  };
  connection.ontrack = (event) => {
    args.events.stream(event.streams[0] ?? new MediaStream([event.track]));
  };
  watchState(connection, args.events.state);
  return {
    async answer(offer, tune) {
      await connection.setRemoteDescription({ type: 'offer', sdp: offer });
      const answer = await connection.createAnswer();
      const sdp = tune(answer.sdp ?? '');
      await connection.setLocalDescription({ type: 'answer', sdp });
      return sdp;
    },
    async addCandidate(candidate) {
      await connection.addIceCandidate(candidate.candidate === '' ? null : candidate);
    },
    close() {
      connection.onconnectionstatechange = null;
      connection.onicecandidate = null;
      connection.ontrack = null;
      connection.close();
    },
    stats: () => connection.getStats(),
  };
}

/** A capture track from `getUserMedia`, as `InputWatcher` uses it. */
export interface BrowserTrack extends CaptureTrack {
  readonly track: MediaStreamTrack;
}

function wrapTrack(track: MediaStreamTrack): BrowserTrack {
  return {
    track,
    get label() {
      return track.label;
    },
    get deviceId() {
      return track.getSettings().deviceId ?? '';
    },
    get muted() {
      return track.muted;
    },
    stop: () => track.stop(),
    on: (event, listener) => track.addEventListener(event, listener),
  };
}

/** `getUserMedia` and `enumerateDevices` for `InputWatcher` (M2.3). */
export function browserMediaPort(
  media: MediaDevices = navigator.mediaDevices,
): MediaPort<BrowserTrack> {
  return {
    async list() {
      const devices = await media.enumerateDevices();
      const inputs: InputDevice[] = devices
        .filter(
          (device) =>
            device.kind === 'audioinput' &&
            device.deviceId !== '' &&
            device.deviceId !== 'default' &&
            device.deviceId !== 'communications',
        )
        .map((device) => ({ id: device.deviceId, name: device.label }));
      const fallback = devices.find(
        (device) => device.kind === 'audioinput' && device.deviceId === 'default',
      );
      return { inputs, defaultLabel: fallback?.label ?? null };
    },
    async open(deviceId) {
      const stream = await media.getUserMedia({
        audio: {
          ...CAPTURE_CONSTRAINTS,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
      });
      const track = stream.getAudioTracks()[0];
      if (!track) {
        for (const each of stream.getTracks()) each.stop();
        throw Object.assign(new Error('No audio track'), { name: 'NotFoundError' });
      }
      return wrapTrack(track);
    },
    visible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
  };
}
