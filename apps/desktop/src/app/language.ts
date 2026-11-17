/**
 * The interface language on this computer (translation plan T2): the Language setting, kept
 * with the other settings of this computer, applied in every window of the app. A change in
 * one window reaches the others through the storage they share.
 */
import { applyPreference, type LanguagePreference, type PSEUDO } from '@worship-q/i18n/desktop';
import { DEVICE_SETTINGS_KEY, deviceSettings } from './deviceSettings';

/** Applies the saved choice now, and again whenever another window changes it. */
export function startLanguage(): void {
  applyPreference(deviceSettings.get().language);
  if (typeof window === 'undefined') return;
  window.addEventListener('storage', (event) => {
    if (event.key === DEVICE_SETTINGS_KEY) applyPreference(deviceSettings.get().language);
  });
}

export function setLanguage(preference: LanguagePreference | typeof PSEUDO): void {
  deviceSettings.set({ language: preference });
  applyPreference(preference);
}
