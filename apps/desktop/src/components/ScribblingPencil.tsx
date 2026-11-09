/**
 * The squiggle the pencil writes, left to right, in the icon's 48 by 24 box: the room on the
 * right is for the pencil at the end of the line.
 */
const SQUIGGLE = 'M2 20q3-3 6 0t6 0t6 0t6 0t6 0';

/**
 * A pencil scribbling a wavy line, in place of the Editor's title: it writes, lifts, and starts
 * again. Its movement is in styles.css; it stands still when the system asks for less motion.
 */
export function ScribblingPencil() {
  return (
    <svg
      className="h-6 w-12 shrink-0"
      viewBox="0 0 48 24"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        className="scribble-line"
        d={SQUIGGLE}
        pathLength={1}
        stroke="#38bdf8"
        strokeWidth="1.75"
      />
      <g className="scribble-pencil-move">
        {/* The pencil's tip, at (2.2, 21.8) in its own box, sits on the line's start. */}
        <g transform="translate(0.7 6.9) scale(0.6)" stroke="currentColor" strokeWidth="2.5">
          <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
          <path d="m15 5 4 4" />
        </g>
      </g>
    </svg>
  );
}
