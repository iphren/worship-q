// Puts the download for the visitor's computer first. Without this every button stays equal.
import './styles.css';

type System = 'mac' | 'windows';

function detect(): System | null {
  const agent = navigator.userAgent;
  if (/Windows/.test(agent)) return 'windows';
  // iPads also call themselves Macintosh, but have a touch screen.
  if (/Macintosh/.test(agent) && navigator.maxTouchPoints <= 1) return 'mac';
  return null;
}

const system = detect();
const button = system && document.querySelector<HTMLElement>(`[data-download="${system}"]`);
if (button) {
  button.dataset.primary = '';
  button.parentElement?.prepend(button);
}
