import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { OUTPUT_WINDOW } from './app/output';
import { OutputApp } from './output/OutputApp';
import './styles.css';

// The same bundle serves both windows; the slideshow window only draws frames.
const isOutput = getCurrentWebviewWindow().label === OUTPUT_WINDOW;

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isOutput ? <OutputApp /> : <App />}</StrictMode>,
);
