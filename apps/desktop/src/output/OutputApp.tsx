import { emit, listen } from '@tauri-apps/api/event';
import { EMPTY_FRAME, type OutputFrame } from '@worship-q/protocol';
import { Slide } from '@worship-q/renderer';
import { useEffect, useState } from 'react';
import { CLOSE_REQUEST_EVENT, FRAME_EVENT, READY_EVENT } from '../app/output';

/** The slideshow window: draws whatever frame the operator window last sent. */
export function OutputApp() {
  const [frame, setFrame] = useState<OutputFrame>(EMPTY_FRAME);
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
      if (event.key === 'Escape') void emit(CLOSE_REQUEST_EVENT);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      stop?.();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        cursor: frame.hideCursor ? 'none' : undefined,
      }}
    >
      <Slide frame={frame} width={size.width} height={size.height} />
    </div>
  );
}
