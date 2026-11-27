import { startBrowserLanguage, t, useLocale } from '@worship-q/i18n/remote';
import { PhoneApp, PhoneListen, PhoneProvider, RemoteConnection } from '@worship-q/phone';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { browserLink } from './browser';
import './styles.css';

startBrowserLanguage();

const connection = new RemoteConnection(browserLink(window.location));
const phone = { connection, listen: new PhoneListen(connection) };

/** Draws the page again in a newly chosen language; nothing below is memoised. */
function Root() {
  const locale = useLocale();
  useEffect(() => {
    document.title = t('app.title');
  }, [locale]);
  return (
    <PhoneProvider phone={phone}>
      <PhoneApp />
    </PhoneProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
