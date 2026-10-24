import { useEffect, useState, type CSSProperties } from 'react';
import { native } from '../platform/native';

/** How often to look again for an image that has not arrived from the church server yet. */
const RETRY_MS = 3000;

/** An imported slide's image, from the app's own storage, or a placeholder until it arrives. */
export function SlideImage(props: { image: string; className?: string; style?: CSSProperties }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const look = () =>
      void native.backgroundUrl(props.image).then((found) => {
        if (!active) return;
        setUrl(found);
        if (!found) timer = window.setTimeout(look, RETRY_MS);
      });
    look();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [props.image]);
  return url ? (
    <img
      src={url}
      alt=""
      draggable={false}
      loading="lazy"
      className={`${props.className ?? ''} object-contain`}
      style={props.style}
    />
  ) : (
    <div className={`${props.className ?? ''} animate-pulse bg-slate-800`} style={props.style} />
  );
}
