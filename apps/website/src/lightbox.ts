// Opens a picture link over the page instead of leaving the site for the bare image. The links
// still lead to the full-size image without JavaScript, or when opened in a new tab.
//
// Opening a picture adds a history entry, so the browser's Back button closes it rather than
// leaving the page. Esc, a click or tap outside the picture, and the close button close it too.

/** A link to one of these opens in the lightbox. */
const PICTURE = /\.(png|jpe?g|webp|avif)$/i;

/** What a picture's history entry remembers. */
interface PictureState {
  picture: string;
}

const isPictureState = (state: unknown): state is PictureState =>
  typeof state === 'object' && state !== null && typeof (state as PictureState).picture === 'string';

const dialog = document.createElement('dialog');
dialog.className = 'lightbox';
const image = document.createElement('img');
const closeButton = document.createElement('button');
closeButton.type = 'button';
closeButton.className = 'lightbox-close';
closeButton.setAttribute('aria-label', 'Close');
closeButton.textContent = '×';
dialog.append(closeButton, image);
document.body.append(dialog);

/** The link to `href` on this page, if there is one. */
function linkTo(href: string): HTMLAnchorElement | undefined {
  return [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].find(
    (link) => link.href === href,
  );
}

/**
 * Shows the picture at `href`. The link's own image, already loaded, shows at once and the
 * full-size picture replaces it when it has arrived.
 */
function show(href: string) {
  const thumbnail = linkTo(href)?.querySelector('img');
  const width = thumbnail?.naturalWidth || Number(thumbnail?.getAttribute('width')) || 16;
  const height = thumbnail?.naturalHeight || Number(thumbnail?.getAttribute('height')) || 10;
  dialog.style.setProperty('--ratio', String(width / height));
  image.alt = thumbnail?.alt ?? '';
  image.src = thumbnail?.currentSrc || href;
  if (image.src !== href) {
    const full = new Image();
    full.src = href;
    full
      .decode()
      .then(() => {
        if (dialog.open && history.state?.picture === href) image.src = href;
      })
      .catch(() => {});
  }
  if (!dialog.open) dialog.showModal();
}

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element | null)?.closest?.('a[href]');
  if (!(link instanceof HTMLAnchorElement) || link.target) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin || !PICTURE.test(url.pathname)) return;
  event.preventDefault();
  history.pushState({ picture: link.href } satisfies PictureState, '');
  show(link.href);
});

// Closed by Esc, the button or a click outside the picture: the picture's history entry goes too.
dialog.addEventListener('close', () => {
  if (isPictureState(history.state)) history.back();
});
closeButton.addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});

// Back closes the picture; Forward opens it again.
window.addEventListener('popstate', (event) => {
  if (isPictureState(event.state)) show(event.state.picture);
  else if (dialog.open) dialog.close();
});

// A reload keeps the picture open.
if (isPictureState(history.state)) show(history.state.picture);
