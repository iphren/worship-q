/**
 * Whether this is the phone and tablet app (native apps plan): the same project built for iOS
 * or Android. Fixed when the interface is built, so each build leaves out the other's shell.
 */
export const IS_MOBILE: boolean =
  import.meta.env.TAURI_ENV_PLATFORM === 'ios' || import.meta.env.TAURI_ENV_PLATFORM === 'android';
