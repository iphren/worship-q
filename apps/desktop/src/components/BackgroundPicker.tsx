import type { BackgroundAsset } from '@worship-q/protocol';
import { useEffect, useState } from 'react';
import { useQuery, useSession } from '../app/context';
import { t } from '../i18n';
import { native } from '../platform/native';

/**
 * A solid color and the imported images and videos to choose a background from. The color
 * is shown behind lyrics when no image or video is chosen, or when its file is missing.
 */
export function BackgroundPicker(props: {
  color: string;
  assetId: string | null;
  onColor(color: string): void;
  onAsset(assetId: string | null): void;
  /** Offers removing a background from the library when given. */
  onRemove?(asset: BackgroundAsset): void;
}) {
  const session = useSession();
  const backgrounds = useQuery(() => session.store.listBackgrounds(session.workspace.id), []);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      (backgrounds ?? []).map(
        async (asset) => [asset.id, await native.backgroundUrl(asset.fileName)] as const,
      ),
    ).then((pairs) => !cancelled && setThumbs(Object.fromEntries(pairs)));
    return () => {
      cancelled = true;
    };
  }, [backgrounds]);

  if (!backgrounds) return null;

  return (
    <>
      <label className="flex items-center gap-3 text-sm">
        <span className="w-40">{t('settings.backgroundColor')}</span>
        <input
          type="color"
          className="h-8 w-14 rounded border border-slate-600 bg-transparent"
          value={props.color}
          onChange={(e) => props.onColor(e.target.value)}
        />
      </label>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
        <button
          type="button"
          className={`flex aspect-video items-center justify-center rounded-md border-2 text-xs ${
            props.assetId === null ? 'border-sky-400' : 'border-slate-600'
          }`}
          style={{ background: props.color }}
          onClick={() => props.onAsset(null)}
        >
          <span className="rounded bg-black/60 px-1.5 py-0.5">{t('settings.backgroundNone')}</span>
        </button>
        {backgrounds.map((asset) => {
          const url = thumbs[asset.id];
          const selected = props.assetId === asset.id;
          return (
            <div
              key={asset.id}
              className={`relative aspect-video overflow-hidden rounded-md border-2 bg-black ${
                selected ? 'border-sky-400' : 'border-slate-600'
              }`}
            >
              <button
                type="button"
                className="absolute inset-0"
                title={asset.originalName}
                onClick={() => props.onAsset(asset.id)}
              >
                {url && asset.kind === 'image' && (
                  <img src={url} alt="" draggable={false} className="h-full w-full object-cover" />
                )}
                {url && asset.kind === 'video' && (
                  <video
                    src={url}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-cover"
                  />
                )}
                {url === null && (
                  <span className="text-xs text-amber-400">{t('settings.backgroundMissing')}</span>
                )}
              </button>
              <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-xs">
                {selected ? `✓ ${t('settings.backgroundSelected')} · ` : ''}
                {asset.originalName}
              </span>
              {props.onRemove && (
                <button
                  type="button"
                  className="absolute top-1 right-1 rounded bg-black/70 px-1.5 text-xs hover:bg-rose-700"
                  title={t('common.remove')}
                  onClick={() => props.onRemove!(asset)}
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
