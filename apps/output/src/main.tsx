import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OutputPage } from './OutputPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OutputPage />
  </StrictMode>,
);
