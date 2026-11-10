import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import { t } from '../i18n';

/**
 * Warns while the app is open more than once on this computer. The copies share one church
 * credential, so each keeps dropping the other's connection, which looks like a bad network.
 * Every copy shows it, and it goes once the others are closed.
 */
export function InstanceBanner() {
  const [others, setOthers] = useState(0);
  useEffect(() => {
    let stopped = false;
    const listening = listen<number>('instances-changed', (event) => setOthers(event.payload));
    invoke<number>('other_instances').then(
      (count) => !stopped && setOthers(count),
      (error) => console.error(error),
    );
    return () => {
      stopped = true;
      void listening.then((unlisten) => unlisten());
    };
  }, []);
  if (others === 0) return null;
  return (
    <div className="notice m-0 rounded-none border-x-0 border-t-0 border-amber-500 bg-amber-900/40 text-amber-100">
      {t('app.openTwice')}
    </div>
  );
}
