import { applyPreference, t, useLocale } from '@worship-q/i18n/output';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { OutputPage } from './OutputPage';

// A screen with no one to choose a language on it: it follows the browser's.
applyPreference('auto');

function Root() {
  const locale = useLocale();
  useEffect(() => {
    document.title = t('app.title');
  }, [locale]);
  return <OutputPage />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
