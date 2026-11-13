import { describe, expect, it } from 'vitest';
import {
  AUDIO_CANDIDATE_MAX,
  AUDIO_DESCRIPTION_MAX,
  AudioSignalSchema,
  AudioStateSchema,
  audioListenerKey,
  tuneOpusDescription,
} from './audio';
import {
  CapabilitiesSchema,
  CoordinatorToFollowerSchema,
  FollowerToCoordinatorSchema,
  RemoteToHostSchema,
} from './wire';

/**
 * Descriptions in the shape each engine produces. They are written from the engines'
 * published formats, not yet recorded from each engine (M1.8 asks for recordings: replace
 * these with real ones from WebKit, WebView2, Chrome, Firefox and iOS Safari when taken).
 */
const CHROME_OFFER = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126',
  'c=IN IP4 0.0.0.0',
  'a=rtcp:9 IN IP4 0.0.0.0',
  'a=ice-ufrag:abcd',
  'a=ice-pwd:abcdefghijklmnopqrstuvwx',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF',
  'a=setup:actpass',
  'a=mid:0',
  'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level',
  'a=sendonly',
  'a=msid:- 1f2e3d4c',
  'a=rtcp-mux',
  'a=rtpmap:111 opus/48000/2',
  'a=rtcp-fb:111 transport-cc',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:63 red/48000/2',
  'a=fmtp:63 111/111',
  'a=rtpmap:9 G722/8000',
  'a=rtpmap:0 PCMU/8000',
  'a=rtpmap:8 PCMA/8000',
  'a=rtpmap:13 CN/8000',
  'a=rtpmap:110 telephone-event/48000',
  'a=rtpmap:126 telephone-event/8000',
  'a=ssrc:12345 cname:abc',
  '',
].join('\r\n');

const FIREFOX_ANSWER = [
  'v=0',
  'o=mozilla...THIS_IS_SDPARTA-99.0 1234 0 IN IP4 0.0.0.0',
  's=-',
  't=0 0',
  'a=fingerprint:sha-256 AA:BB',
  'a=group:BUNDLE 0',
  'a=ice-options:trickle',
  'a=msid-semantic:WMS *',
  'm=audio 9 UDP/TLS/RTP/SAVPF 109 101',
  'c=IN IP4 0.0.0.0',
  'a=recvonly',
  'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level',
  'a=fmtp:109 maxplaybackrate=48000;stereo=1;useinbandfec=1',
  'a=fmtp:101 0-15',
  'a=ice-pwd:x',
  'a=ice-ufrag:y',
  'a=mid:0',
  'a=rtcp-mux',
  'a=rtpmap:109 opus/48000/2',
  'a=rtpmap:101 telephone-event/8000',
  'a=setup:active',
  '',
].join('\r\n');

/** WebKit (the macOS app and iOS Safari) writes no fmtp line for Opus in some answers. */
const WEBKIT_ANSWER = [
  'v=0',
  'o=- 1 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 13',
  'c=IN IP4 0.0.0.0',
  'a=mid:0',
  'a=recvonly',
  'a=rtcp-mux',
  'a=rtpmap:111 OPUS/48000/2',
  'a=rtcp-fb:111 transport-cc',
  'a=rtpmap:13 CN/8000',
  'a=ptime:20',
  '',
].join('\n');

const fmtpOf = (sdp: string, pt: string) =>
  sdp.split(/\r?\n/).find((line) => line.startsWith(`a=fmtp:${pt} `)) ?? '';

const SETTINGS = [
  'minptime=10',
  'useinbandfec=1',
  'usedtx=0',
  'maxaveragebitrate=64000',
  'stereo=0',
  'sprop-stereo=0',
];

describe('the Opus settings (A7)', () => {
  for (const [name, sdp, pt] of [
    ['Chrome offer', CHROME_OFFER, '111'],
    ['Firefox answer', FIREFOX_ANSWER, '109'],
    ['WebKit answer', WEBKIT_ANSWER, '111'],
  ] as const) {
    it(`puts all six settings once, and ptime 10 once, in a ${name}`, () => {
      const tuned = tuneOpusDescription(sdp);
      const params = fmtpOf(tuned, pt).split(' ')[1]!.split(';');
      for (const setting of SETTINGS) {
        expect(params.filter((p) => p === setting)).toHaveLength(1);
      }
      expect(tuned.split(/\r?\n/).filter((line) => line.startsWith('a=ptime:'))).toEqual([
        'a=ptime:10',
      ]);
    });

    it(`leaves every other line of a ${name} as it was`, () => {
      const tuned = tuneOpusDescription(sdp);
      const others = (text: string) =>
        text
          .split(/\r?\n/)
          .filter((line) => !line.startsWith(`a=fmtp:${pt} `) && !line.startsWith('a=ptime:'));
      expect(others(tuned)).toEqual(others(sdp));
    });

    it(`gives the same text when applied twice to a ${name}`, () => {
      const once = tuneOpusDescription(sdp);
      expect(tuneOpusDescription(once)).toBe(once);
    });
  }

  it('finds Opus by its rtpmap line, whatever its payload type', () => {
    expect(fmtpOf(tuneOpusDescription(FIREFOX_ANSWER), '109')).toContain('usedtx=0');
  });

  it('adds a format line after the rtpmap line when there is none', () => {
    const lines = tuneOpusDescription(WEBKIT_ANSWER).split('\n');
    const at = lines.indexOf('a=rtpmap:111 OPUS/48000/2');
    expect(lines[at + 1]).toMatch(/^a=fmtp:111 minptime=10;/);
  });

  it('replaces settings already there with other values, and keeps those it does not know', () => {
    const params = fmtpOf(tuneOpusDescription(FIREFOX_ANSWER), '109').split(' ')[1]!.split(';');
    expect(params).toContain('maxplaybackrate=48000');
    expect(params).toContain('stereo=0');
    expect(params).not.toContain('stereo=1');
    const custom = CHROME_OFFER.replace(
      'a=fmtp:111 minptime=10;useinbandfec=1',
      'a=fmtp:111 minptime=20;usedtx=1;stereo=1',
    );
    const tuned = fmtpOf(tuneOpusDescription(custom), '111');
    expect(tuned).not.toMatch(/minptime=20|usedtx=1|stereo=1/);
  });

  it('leaves the other codecs alone', () => {
    const tuned = tuneOpusDescription(CHROME_OFFER);
    expect(fmtpOf(tuned, '63')).toBe('a=fmtp:63 111/111');
    expect(tuned).toContain('a=rtpmap:110 telephone-event/48000');
    expect(fmtpOf(tuneOpusDescription(FIREFOX_ANSWER), '101')).toBe('a=fmtp:101 0-15');
  });

  it('keeps the line endings as they came', () => {
    expect(tuneOpusDescription(CHROME_OFFER)).toContain('\r\n');
    expect(tuneOpusDescription(WEBKIT_ANSWER)).not.toContain('\r');
    expect(tuneOpusDescription(CHROME_OFFER).endsWith('\r\n')).toBe(true);
  });

  it('returns a description without audio, or without Opus, unchanged', () => {
    const video = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n';
    expect(tuneOpusDescription(video)).toBe(video);
    const pcmu = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 0\r\na=rtpmap:0 PCMU/8000\r\na=ptime:20\r\n';
    expect(tuneOpusDescription(pcmu)).toBe(pcmu);
  });
});

describe('audio signals and their limits', () => {
  const session = 's-1';
  const valid = [
    { kind: 'listen', session },
    { kind: 'listen', session, restart: true },
    { kind: 'offer', session, sdp: 'v=0' },
    { kind: 'answer', session, sdp: 'v=0' },
    {
      kind: 'candidate',
      session,
      candidate: {
        candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      },
    },
    { kind: 'close', session, reason: 'stopped' },
    { kind: 'full', session },
    { kind: 'retaken', session },
  ];

  it('parses each signal with its fields', () => {
    for (const signal of valid) expect(AudioSignalSchema.safeParse(signal).success).toBe(true);
  });

  it('refuses each signal with a field missing', () => {
    expect(AudioSignalSchema.safeParse({ kind: 'listen' }).success).toBe(false);
    expect(AudioSignalSchema.safeParse({ kind: 'offer', session }).success).toBe(false);
    expect(AudioSignalSchema.safeParse({ kind: 'answer', session }).success).toBe(false);
    expect(AudioSignalSchema.safeParse({ kind: 'candidate', session }).success).toBe(false);
    expect(AudioSignalSchema.safeParse({ kind: 'close', session }).success).toBe(false);
    expect(AudioSignalSchema.safeParse({ kind: 'full' }).success).toBe(false);
    expect(AudioSignalSchema.safeParse({ kind: 'retaken' }).success).toBe(false);
  });

  it('refuses an unknown signal', () => {
    expect(AudioSignalSchema.safeParse({ kind: 'mute', session }).success).toBe(false);
  });

  it('takes a description of exactly 16 KB, and refuses one byte more', () => {
    const at = 'x'.repeat(AUDIO_DESCRIPTION_MAX);
    expect(AudioSignalSchema.safeParse({ kind: 'offer', session, sdp: at }).success).toBe(true);
    expect(AudioSignalSchema.safeParse({ kind: 'offer', session, sdp: `${at}x` }).success).toBe(
      false,
    );
  });

  it('takes a candidate of 1 KB, and refuses one byte more', () => {
    const at = 'c'.repeat(AUDIO_CANDIDATE_MAX);
    const signal = (candidate: string) => ({
      kind: 'candidate',
      session,
      candidate: { candidate },
    });
    expect(AudioSignalSchema.safeParse(signal(at)).success).toBe(true);
    expect(AudioSignalSchema.safeParse(signal(`${at}c`)).success).toBe(false);
  });

  it('takes the empty candidate that ends the candidates', () => {
    expect(
      AudioSignalSchema.safeParse({ kind: 'candidate', session, candidate: { candidate: '' } })
        .success,
    ).toBe(true);
  });

  it('takes a session id of 100 characters, and refuses 101 or none', () => {
    const listen = (id: string) => AudioSignalSchema.safeParse({ kind: 'listen', session: id });
    expect(listen('s'.repeat(100)).success).toBe(true);
    expect(listen('s'.repeat(101)).success).toBe(false);
    expect(listen('').success).toBe(false);
  });

  it('takes an offer with ICE servers, refusing more than eight or another kind of address', () => {
    const offer = (iceServers: unknown) =>
      AudioSignalSchema.safeParse({ kind: 'offer', session, sdp: 'v=0', iceServers });
    const stun = { urls: 'stun:stun.l.google.com:19302' };
    const turn = {
      urls: ['turn:turn.example.org:3478?transport=udp'],
      username: '1',
      credential: 'p',
    };
    expect(offer([stun, turn]).success).toBe(true);
    expect(offer(Array(9).fill(stun)).success).toBe(false);
    expect(offer([{ urls: 'https://example.org' }]).success).toBe(false);
  });

  it('parses a phone’s signal on the remote channel with the same limits', () => {
    expect(
      RemoteToHostSchema.safeParse({ type: 'audioSignal', signal: { kind: 'listen', session } })
        .success,
    ).toBe(true);
    expect(
      RemoteToHostSchema.safeParse({
        type: 'audioSignal',
        signal: { kind: 'offer', session, sdp: 'x'.repeat(AUDIO_DESCRIPTION_MAX + 1) },
      }).success,
    ).toBe(false);
  });
});

describe('audio on the coordinator’s channels (protocol version 7)', () => {
  const state = {
    ownerId: 'A',
    ownerName: 'Sound desk',
    activatedAt: '2026-11-13T09:00:00.000Z',
    revision: 1,
    active: true,
    status: 'live',
    inputName: 'Scarlett 2i2 USB',
    listeners: 3,
  };

  it('parses the audio state, refusing a listener count over ten', () => {
    expect(AudioStateSchema.safeParse(state).success).toBe(true);
    expect(AudioStateSchema.safeParse({ ...state, listeners: 11 }).success).toBe(false);
  });

  it('carries the state and addressed signals up and down', () => {
    expect(FollowerToCoordinatorSchema.safeParse({ type: 'audioState', state }).success).toBe(true);
    expect(
      FollowerToCoordinatorSchema.safeParse({
        type: 'audioSignal',
        to: 'A',
        phone: { grantId: 'g1', name: 'Phone' },
        signal: { kind: 'listen', session: 's' },
      }).success,
    ).toBe(true);
    expect(CoordinatorToFollowerSchema.safeParse({ type: 'audioState', state: null }).success).toBe(
      true,
    );
    expect(
      CoordinatorToFollowerSchema.safeParse({
        type: 'audioSignal',
        from: 'A',
        listener: { kind: 'desktop', deviceId: 'B', name: 'Booth' },
        signal: { kind: 'retaken', session: 's' },
      }).success,
    ).toBe(true);
  });

  it('still parses a version 6 hello without the audio capability', () => {
    const parsed = CapabilitiesSchema.parse({ roles: ['display'], appVersion: '2.2.0' });
    expect(parsed.audio).toBeUndefined();
  });

  it('counts a listener by who it is, not by connection (A20)', () => {
    expect(audioListenerKey({ kind: 'desktop', deviceId: 'B', name: 'x' })).toBe('desktop:B');
    expect(audioListenerKey({ kind: 'phone', grantId: 'g', name: 'y' })).toBe('phone:g');
    expect(audioListenerKey({ kind: 'admin', sessionId: 'a', name: 'z' })).toBe('admin:a');
  });
});
