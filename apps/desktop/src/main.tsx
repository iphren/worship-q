import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useLocale } from '@worship-q/i18n/desktop';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startAppMenu } from './app/appMenu';
import { startLanguage } from './app/language';
import { OUTPUT_WINDOW } from './app/output';
import { unlockAudioDeviceNames } from './components/AudioSettings';
import { MobileApp } from './mobile/MobileApp';
import { OutputApp } from './output/OutputApp';
import { IS_MOBILE } from './platform/mobile';
import './styles.css';

startLanguage();

// The same bundle serves both windows; the slideshow window only draws frames. The phone and
// tablet app has its own shell, with no menu bar (native apps plan).
const isOutput = !IS_MOBILE && getCurrentWebviewWindow().label === OUTPUT_WINDOW;
if (!isOutput && !IS_MOBILE) {
  void unlockAudioDeviceNames();
  startAppMenu();
}

/**
 * Draws the window again in a newly chosen language. Rendering the root again renders every
 * component below it (none is memoised), so open pages and dialogs keep their place.
 */
function Root() {
  useLocale();
  if (IS_MOBILE) return <MobileApp />;
  return isOutput ? <OutputApp /> : <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
