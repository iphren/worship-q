/**
 * The icons of buttons the desktop and phones share, so a control looks the same on both.
 * Buttons show the icon alone and carry their words in `title` and `aria-label`, which keeps
 * them small whatever the language.
 */
import type { ReactNode } from 'react';

/** Each control's icon, drawn in a 24 by 24 box with a 2-pixel stroke. */
export const CONTROL_ICON_SHAPES = {
  previous: <path d="M12 19V5M5 12l7-7 7 7" />,
  next: <path d="M12 5v14M19 12l-7 7-7-7" />,
  blank: (
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20" />
  ),
  clear: (
    <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21M22 21H7M5 11l9 9" />
  ),
  /** Adds the thing beside it. */
  add: <path d="M5 12h14M12 5v14" />,
  /** Opens a search for something to add to the run sheet. */
  addToList: <path d="M11 12H3M16 6H3M16 18H3M18 9v6M21 12h-6" />,
  /** Chooses files to add as media items. */
  addMedia: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4M9 15h6M12 12v6" />
    </>
  ),
  play: <path d="M7 4l13 8-13 8z" fill="currentColor" />,
  pause: (
    <>
      <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" />
      <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" />
    </>
  ),
  back10: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
      <SecondsLabel />
    </>
  ),
  forward10: (
    <>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8M21 3v5h-5" />
      <SecondsLabel />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type ControlIconName = keyof typeof CONTROL_ICON_SHAPES;

/** The "10" inside the jump arrows. */
function SecondsLabel() {
  return (
    <text
      x="12"
      y="15.5"
      textAnchor="middle"
      fontSize="9.5"
      fontWeight="700"
      fill="currentColor"
      stroke="none"
      fontFamily="system-ui, sans-serif"
    >
      10
    </text>
  );
}

/** A control's icon on its own, in the current text colour. */
export function ControlIcon(props: { name: ControlIconName; className?: string }) {
  return (
    <svg
      className={props.className ?? 'h-5 w-5'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {CONTROL_ICON_SHAPES[props.name]}
    </svg>
  );
}
