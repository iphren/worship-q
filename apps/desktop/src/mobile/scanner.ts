import {
  cancel,
  checkPermissions,
  Format,
  openAppSettings,
  requestPermissions,
  scan,
} from '@tauri-apps/plugin-barcode-scanner';

export type ScanResult =
  { kind: 'scanned'; text: string } | { kind: 'cancelled' } | { kind: 'no-camera' };

/**
 * Scans one QR code with the camera behind the page (native apps plan M2.11). The page draws
 * its own frame and Cancel button over it, so `html.scanning` makes the page see-through.
 */
export async function scanQrCode(): Promise<ScanResult> {
  let permission = await checkPermissions();
  if (permission !== 'granted') permission = await requestPermissions();
  if (permission !== 'granted') return { kind: 'no-camera' };
  document.documentElement.classList.add('scanning');
  try {
    const { content } = await scan({ windowed: true, formats: [Format.QRCode] });
    return { kind: 'scanned', text: content };
  } catch {
    return { kind: 'cancelled' };
  } finally {
    document.documentElement.classList.remove('scanning');
  }
}

export const cancelScan = () => cancel().catch(() => undefined);
export const openCameraSettings = () => openAppSettings().catch(() => undefined);
