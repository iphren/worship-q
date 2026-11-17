import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useLocale } from '@worship-q/i18n/desktop';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startLanguage } from './app/language';
import { OUTPUT_WINDOW } from './app/output';
import { unlockAudioDeviceNames } from './components/AudioSettings';
import { OutputApp } from './output/OutputApp';
import './styles.css';

startLanguage();

// The same bundle serves both windows; the slideshow window only draws frames.
const isOutput = getCurrentWebviewWindow().label === OUTPUT_WINDOW;
if (!isOutput) void unlockAudioDeviceNames();

/**
 * Draws the window again in a newly chosen language. Rendering the root again renders every
 * component below it (none is memoised), so open pages and dialogs keep their place.
 */
function Root() {
  useLocale();
  return isOutput ? <OutputApp /> : <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
