/**
 * Live audio broadcast (live audio plan, decisions A1–A24): the audio state a workspace
 * shares, the signals that set up one peer connection per listener, and the Opus settings
 * every connection uses.
 *
 * One desktop of the workspace broadcasts its chosen input, in any role (A3). It owns the
 * audio state and publishes it to the coordinator, which passes it on to the other desktops
 * and they to their phones. A listener asks the broadcaster for a connection with `listen`;
 * the broadcaster answers with an offer, the listener with an answer carrying the tuned Opus
 * settings, and candidates travel both ways. The audio itself goes peer-to-peer, or through
 * the church's TURN relay; the coordinator and the relay forward signals and keep none.
 *
 * Every signal names its session, one connection between the broadcaster and one listener.
 * A listener that connects afresh (A17) opens a new session and closes the old one after.
 * Sizes are capped: a description at 16 KB, a candidate at 1 KB, a session id at 100
 * characters, so the relay refuses anything larger before it is forwarded.
 *
 * These messages came with protocol version 7, and a coordinator sends them only to devices
 * that declare the `audio` capability, so older desktops see nothing new.
 */
import { z } from 'zod';

/** The protocol version that carries audio messages; the relay refuses them before it. */
export const AUDIO_PROTOCOL_VERSION = 7;

/** Listeners at once, desktops, phones and administrators together (A2); fixed. */
export const AUDIO_LISTENER_LIMIT = 10;

/** The largest session description, in characters. */
export const AUDIO_DESCRIPTION_MAX = 16 * 1024;
/** The largest ICE candidate line, in characters. */
export const AUDIO_CANDIDATE_MAX = 1024;
/** The longest session id. */
export const AUDIO_SESSION_MAX = 100;
/** ICE servers an offer may carry. */
export const AUDIO_ICE_SERVERS_MAX = 8;

/**
 * The broadcast as other devices see it (plan §3): sending, waiting for its input device
 * (also while the sending computer's window is out of view, A19), or refused the microphone.
 */
export const AudioStatusSchema = z.enum(['live', 'waiting', 'refused']);
export type AudioStatus = z.infer<typeof AudioStatusSchema>;

/**
 * The workspace's audio state, owned by the broadcasting desktop (A3). A later activation
 * takes it over: see `newerAudioState` in `@worship-q/live-state`.
 */
export const AudioStateSchema = z.object({
  /** The broadcasting device. */
  ownerId: z.string().min(1).max(100),
  ownerName: z.string().max(100),
  /** When the broadcast was switched on; the later activation wins. */
  activatedAt: z.string().min(1).max(40),
  /** Increases with each state the owner sends for one activation. */
  revision: z.number().int().min(0),
  /** False once the owner switched the broadcast off: listening stops everywhere. */
  active: z.boolean(),
  status: AudioStatusSchema,
  /** The input device's name, for **Waiting for input**; null for the system default. */
  inputName: z.string().max(200).nullable(),
  /** Listeners connected now, counted by who they are (A20). */
  listeners: z.number().int().min(0).max(AUDIO_LISTENER_LIMIT),
});
export type AudioState = z.infer<typeof AudioStateSchema>;

/**
 * Who listens (A4, A20): a desktop, a phone by its grant, or an administrator. For an
 * administrator `sessionId` is whatever the server says stays the same while they listen:
 * their page's id, for every session it opens, or the session's own id from a server that
 * names no page.
 */
export const AudioListenerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('desktop'),
    deviceId: z.string().min(1).max(100),
    name: z.string().max(100),
  }),
  z.object({
    kind: z.literal('phone'),
    grantId: z.string().min(1).max(100),
    name: z.string().max(100),
  }),
  z.object({
    kind: z.literal('admin'),
    sessionId: z.string().min(1).max(100),
    name: z.string().max(100),
  }),
]);
export type AudioListener = z.infer<typeof AudioListenerSchema>;

/** The same listener, whichever connection it came by; the limit of ten counts these (A20). */
export function audioListenerKey(listener: AudioListener): string {
  switch (listener.kind) {
    case 'desktop':
      return `desktop:${listener.deviceId}`;
    case 'phone':
      return `phone:${listener.grantId}`;
    case 'admin':
      return `admin:${listener.sessionId}`;
  }
}

/** A phone named in a signal: the listener when a desktop forwards it, the addressee back. */
export const AudioPhoneSchema = z.object({
  grantId: z.string().min(1).max(100),
  name: z.string().max(100),
});
export type AudioPhone = z.infer<typeof AudioPhoneSchema>;

const ICE_URL = z
  .string()
  .max(300)
  .regex(/^(stun|stuns|turn|turns):/);

/** An ICE server as `RTCPeerConnection` takes it; a relay carries a short-lived credential. */
export const IceServerSchema = z.object({
  urls: z.union([ICE_URL, z.array(ICE_URL).min(1).max(4)]),
  username: z.string().max(200).optional(),
  credential: z.string().max(200).optional(),
});
export type IceServer = z.infer<typeof IceServerSchema>;

/** An ICE candidate as `RTCIceCandidateInit` has it; an empty line ends the candidates. */
export const AudioCandidateSchema = z.object({
  candidate: z.string().max(AUDIO_CANDIDATE_MAX),
  sdpMid: z.string().max(40).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(100).nullable().optional(),
});
export type AudioCandidate = z.infer<typeof AudioCandidateSchema>;

const SessionSchema = z.string().min(1).max(AUDIO_SESSION_MAX);
const DescriptionSchema = z.string().min(1).max(AUDIO_DESCRIPTION_MAX);

/** Why a session was closed. */
export const AUDIO_CLOSE = {
  /** The listener released **Listen**, or the broadcast was switched off or taken over. */
  stopped: 'stopped',
  /** The device addressed is not connected, or does not take audio. */
  gone: 'gone',
  /** The addressee does not broadcast. */
  notBroadcasting: 'not-broadcasting',
  /** A fresh connection replaced this one (A17). */
  replaced: 'replaced',
  /** Nothing came from the other end for too long. */
  timeout: 'timeout',
} as const;

/**
 * One step of setting up, keeping or ending a session. `listen` with `restart` asks for an
 * ICE restart on a session that went `disconnected`; `full` refuses an eleventh listener;
 * `retaken` tells a listener the broadcaster took its input again, so it connects afresh.
 */
export const AudioSignalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('listen'), session: SessionSchema, restart: z.boolean().optional() }),
  z.object({
    kind: z.literal('offer'),
    session: SessionSchema,
    sdp: DescriptionSchema,
    /** For a phone or an administrator, which have no credential of their own (M4.3). */
    iceServers: z.array(IceServerSchema).max(AUDIO_ICE_SERVERS_MAX).optional(),
  }),
  z.object({ kind: z.literal('answer'), session: SessionSchema, sdp: DescriptionSchema }),
  z.object({
    kind: z.literal('candidate'),
    session: SessionSchema,
    candidate: AudioCandidateSchema,
  }),
  z.object({ kind: z.literal('close'), session: SessionSchema, reason: z.string().max(40) }),
  z.object({ kind: z.literal('full'), session: SessionSchema }),
  z.object({ kind: z.literal('retaken'), session: SessionSchema }),
]);
export type AudioSignal = z.infer<typeof AudioSignalSchema>;

/** What a phone is shown of the broadcast, inside its view; absent or null when none. */
export interface RemoteAudioView {
  /** The broadcaster and its activation, so a phone notices a restart or a take-over. */
  ownerId: string;
  ownerName: string;
  activatedAt: string;
  status: AudioStatus;
}

// ── The Opus settings (A7) ─────────────────────────────────────────────────

/** What the listener's answer asks of the broadcaster's encoder (A7). */
export const OPUS_SETTINGS: ReadonlyArray<readonly [string, string]> = [
  ['minptime', '10'],
  ['useinbandfec', '1'],
  ['usedtx', '0'],
  ['maxaveragebitrate', '64000'],
  ['stereo', '0'],
  ['sprop-stereo', '0'],
];

/**
 * A session description with the Opus settings of A7: mono, 10 ms frames, 64 kbps, in-band
 * FEC on and DTX off, and `a=ptime:10` in the audio section. Only the Opus format line and
 * the audio section's packet time change; every other line, and the line endings, stay as
 * they came. A description it does not recognise (no audio section, no Opus) comes back
 * unchanged, so the connection still works at the engine's defaults. Running it twice gives
 * the same text.
 */
export function tuneOpusDescription(sdp: string): string {
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const trailing = sdp.endsWith(eol);
  const lines = (trailing ? sdp.slice(0, -eol.length) : sdp).split(eol);
  // Sections start at each `m=` line; the first holds the session-level lines.
  const sections: string[][] = [[]];
  for (const line of lines) {
    if (line.startsWith('m=')) sections.push([]);
    sections[sections.length - 1]!.push(line);
  }
  let changed = false;
  const tuned = sections.map((section) => {
    if (!section[0]?.startsWith('m=audio')) return section;
    const rtpmap = section.find((line) => /^a=rtpmap:\d+ opus\/48000/i.test(line));
    if (!rtpmap) return section;
    const pt = /^a=rtpmap:(\d+)/.exec(rtpmap)![1]!;
    changed = true;
    const out: string[] = [];
    let fmtpSeen = false;
    for (const line of section) {
      if (line.startsWith('a=ptime:')) continue;
      if (line.startsWith(`a=fmtp:${pt} `)) {
        fmtpSeen = true;
        out.push(`a=fmtp:${pt} ${mergeParams(line.slice(`a=fmtp:${pt} `.length))}`);
        continue;
      }
      out.push(line);
      if (line === rtpmap && !section.some((each) => each.startsWith(`a=fmtp:${pt} `))) {
        fmtpSeen = true;
        out.push(`a=fmtp:${pt} ${mergeParams('')}`);
      }
    }
    if (!fmtpSeen) return section;
    // The packet time goes after the last format line, where engines put it.
    const lastFormat = out.reduce(
      (at, line, index) => (/^a=(rtpmap|fmtp|rtcp-fb):/.test(line) ? index : at),
      0,
    );
    out.splice(lastFormat + 1, 0, 'a=ptime:10');
    return out;
  });
  if (!changed) return sdp;
  const joined = tuned.flat().join(eol);
  return trailing ? joined + eol : joined;
}

/** Opus format parameters with A7's settings in place of any of theirs, others kept. */
function mergeParams(params: string): string {
  const ours = new Map(OPUS_SETTINGS);
  const kept = params
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .filter((part) => !ours.has(part.split('=')[0]!.trim().toLowerCase()));
  return [...kept, ...OPUS_SETTINGS.map(([key, value]) => `${key}=${value}`)].join(';');
}
