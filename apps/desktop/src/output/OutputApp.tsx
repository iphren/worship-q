import { emit, listen } from '@tauri-apps/api/event';
import { EMPTY_FRAME, youtubeEmbedUrl, type OutputFrame } from '@worship-q/protocol';
import { Slide } from '@worship-q/renderer';
import { useEffect, useRef, useState } from 'react';
import {
  ACTION_EVENT,
  AUDIO_OUTPUT_EVENT,
  CLOSE_REQUEST_EVENT,
  FRAME_EVENT,
  READY_EVENT,
} from '../app/output';
import { keyPress, presentAction } from '../lib/shortcuts';
import { deviceSettings, findDevice } from '../app/deviceSettings';
import { listAudioDevices } from '../components/AudioSettings';
import { native } from '../platform/native';

/** The slideshow window: draws whatever frame the operator window last sent. */
export function OutputApp() {
  const [frame, setFrame] = useState<OutputFrame>(EMPTY_FRAME);
  // A video item is live: the keys play, pause and move through it (M6.5).
  const videoLive = useRef(false);
  videoLive.current = !!frame.video;
  const sinkId = useAudioOutput();
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void listen<OutputFrame>(FRAME_EVENT, (event) => setFrame(event.payload)).then((unlisten) => {
      if (cancelled) return unlisten();
      stop = unlisten;
      // Ask for the current frame now that this window can receive it.
      void emit(READY_EVENT);
    });
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return void emit(CLOSE_REQUEST_EVENT);
      // The operator window owns the presentation and decides what a key does, as only it
      // knows where the slide keys are; this window only passes the keys on.
      if (!presentAction(event, { video: videoLive.current ? 'keyed' : null })) return;
      event.preventDefault();
      void emit(ACTION_EVENT, keyPress(event));
    };
    // A windowed slideshow has no title bar; it is moved by dragging anywhere on it.
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 0) void native.dragOutput();
    };
    // Nothing here scrolls, including the elastic pull a trackpad gives a page.
    const onScroll = (event: Event) => event.preventDefault();
    const root = document.documentElement;
    root.style.overflow = 'hidden';
    root.style.overscrollBehavior = 'none';
    window.addEventListener('wheel', onScroll, { passive: false });
    window.addEventListener('touchmove', onScroll, { passive: false });
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      cancelled = true;
      stop?.();
      root.style.overflow = '';
      root.style.overscrollBehavior = '';
      window.removeEventListener('wheel', onScroll);
      window.removeEventListener('touchmove', onScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, []);

  // A website is shown by a webview of its own over this page, opened by the native side.
  const websiteUrl = frame.website?.url ?? null;
  useEffect(() => {
    // A YouTube link shows its video alone, in place of YouTube's page.
    const embed = websiteUrl ? youtubeEmbedUrl(websiteUrl) : null;
    void native.outputWebsite(websiteUrl, embed).catch(console.error);
  }, [websiteUrl]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        cursor: frame.hideCursor ? 'none' : undefined,
      }}
    >
      {/* The slideshow window is the only place a video item's sound plays. */}
      <Slide
        frame={frame}
        width={size.width}
        height={size.height}
        transition
        sound
        sinkId={sinkId}
      />
      {frame.message && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.55)',
            fontSize: Math.round(size.height / 24),
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {frame.message}
        </div>
      )}
    </div>
  );
}

declare global {
  interface Window {
    /** Called by the native core's script call, which macOS counts as a gesture (M0.3). */
    __worshipQSink?: (id: string) => Promise<void>;
  }
}

/**
 * The audio output chosen in Settings, for this window's video sound (U24). On opening, and
 * whenever the choice changes, the window asks for audio and stops it at once, which makes
 * the device ids usable here; it finds the device by id, then by name, and the native core
 * applies it through one script call, which unlocks `setSinkId` without a click on macOS.
 * A device that is not connected leaves the system default.
 */
function useAudioOutput(): string {
  const [sinkId, setSinkId] = useState('');
  useEffect(() => {
    let active = true;
    type Sinkable = HTMLMediaElement & { setSinkId?(id: string): Promise<void> };
    window.__worshipQSink = async (id: string) => {
      // Called inside the native script call, which counts as a gesture on macOS: a video
      // already playing is moved here, synchronously, before the gesture can lapse.
      const playing = Array.from(document.querySelectorAll<Sinkable>('video'));
      const moves = playing.map((element) => element.setSinkId?.(id).catch(() => undefined));
      const probe = document.createElement('audio') as Sinkable;
      await Promise.all([...moves, probe.setSinkId?.(id).catch(() => undefined)]);
      if (active) setSinkId(id);
    };
    const apply = async () => {
      const chosen = deviceSettings.get().audioOutput;
      const id = chosen ? (findDevice((await listAudioDevices()).outputs, chosen)?.id ?? '') : '';
      await native.outputAudioSink(id).catch(() => window.__worshipQSink?.(id));
    };
    void apply();
    // Settings tells this window directly when the output changes.
    let stop: (() => void) | undefined;
    void listen(AUDIO_OUTPUT_EVENT, () => void apply()).then((unlisten) => {
      if (active) stop = unlisten;
      else unlisten();
    });
    return () => {
      active = false;
      stop?.();
    };
  }, []);
  return sinkId;
}
