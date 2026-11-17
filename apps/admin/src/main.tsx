import { startBrowserLanguage, t, useLocale } from '@worship-q/i18n/admin';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminApp } from './AdminApp';
import './styles.css';

startBrowserLanguage();

/** Draws the page again in a newly chosen language; nothing below is memoised. */
function Root() {
  const locale = useLocale();
  useEffect(() => {
    document.title = t('app.title');
  }, [locale]);
  return <AdminApp />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
