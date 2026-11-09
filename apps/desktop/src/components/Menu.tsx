import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export interface MenuItem {
  key: string;
  label: string;
  onSelect(): void;
  /** Why it cannot be used now; shown disabled with this as its hint. */
  disabled?: string | null;
  danger?: boolean;
  /** Set apart from the items before it. */
  separated?: boolean;
}

/**
 * A **⋯** button opening a small menu (U27). It opens on a click and with Enter or Space,
 * moves with the arrow keys, and closes with Escape or a click outside. Near the bottom of
 * the window it opens upwards. It is drawn over the whole window, so a scrolling list cannot
 * hide it; scrolling or resizing closes it.
 */
export function Menu(props: { label: string; items: readonly MenuItem[]; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({ visibility: 'hidden' });
  const [active, setActive] = useState(0);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const enabled = props.items
    .map((item, index) => (item.disabled ? -1 : index))
    .filter((index) => index >= 0);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !list.current?.contains(target)) setOpen(false);
    };
    const away = (event: Event) => {
      if (!list.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPlace({ visibility: 'hidden' });
      return;
    }
    if (!list.current || !button.current) return;
    const box = button.current.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    // The whole box, borders included, as `maxHeight` counts them too.
    const height = list.current.offsetHeight;
    const below = window.innerHeight - box.bottom - margin - gap;
    const above = box.top - margin - gap;
    const upwards = height > below && above > below;
    setPlace({
      right: Math.max(margin, window.innerWidth - box.right),
      maxHeight: Math.max(0, upwards ? above : below),
      ...(upwards ? { bottom: window.innerHeight - box.top + gap } : { top: box.bottom + gap }),
    });
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !list.current) return;
    const items = list.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    items[active]?.focus({ preventScroll: true });
  }, [open, active, place]);

  const close = () => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  };
  const move = (by: 1 | -1) => {
    if (enabled.length === 0) return;
    const at = enabled.indexOf(active);
    setActive(enabled[(at + by + enabled.length) % enabled.length]!);
  };

  return (
    <span ref={root} className="relative">
      <button
        ref={button}
        type="button"
        className="btn btn-ghost btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={props.label}
        title={props.label}
        onClick={(event) => {
          event.stopPropagation();
          setActive(enabled[0] ?? 0);
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setActive(event.key === 'ArrowDown' ? (enabled[0] ?? 0) : (enabled.at(-1) ?? 0));
            setOpen(true);
          }
        }}
      >
        {props.trigger ?? <Icon name="more" className="h-4 w-4" />}
      </button>
      {open &&
        createPortal(
          <ul
            ref={list}
            role="menu"
            aria-label={props.label}
            style={place}
            className="fixed z-50 min-w-48 overflow-y-auto rounded-md border border-slate-600 bg-slate-800 py-1 shadow-xl shadow-black/50"
            onKeyDown={(event) => {
              // The run sheet's own keys must not act while the menu is open.
              event.stopPropagation();
              if (event.key === 'Escape') {
                event.preventDefault();
                close();
              } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                move(event.key === 'ArrowDown' ? 1 : -1);
              } else if (event.key === 'Tab') {
                setOpen(false);
              }
            }}
          >
            {props.items.map((item, index) => (
              <li
                key={item.key}
                role="none"
                className={item.separated ? 'mt-1 border-t border-slate-700 pt-1' : undefined}
              >
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={index === active ? 0 : -1}
                  disabled={!!item.disabled}
                  title={item.disabled ?? undefined}
                  className={`block w-full px-3 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:text-slate-500 ${
                    item.danger ? 'text-rose-300' : 'text-slate-100'
                  } enabled:hover:bg-slate-700 focus:bg-slate-700 focus:outline-none`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  {item.label}
                  {item.disabled && (
                    <span className="block text-[11px] text-slate-500">{item.disabled}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </span>
  );
}
