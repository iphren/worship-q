import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROUTER_ORIGIN, ROUTER_PATH } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';

/**
 * The phone and tablet builds must agree with the link router, or invitation links silently
 * open the browser instead of the app (native apps plan; the spike found Tauri does not write
 * the Associated Domains entitlement itself).
 */
const tauri = resolve(__dirname, '../src-tauri');
const read = (path: string) => readFileSync(resolve(tauri, path), 'utf8');
interface MobileConfig {
  identifier: string;
  bundle: { iOS?: { developmentTeam: string } };
  plugins: { 'deep-link': { mobile: unknown[] } };
}
const json = (path: string) => JSON.parse(read(path)) as MobileConfig;
const routerHost = new URL(ROUTER_ORIGIN).host;

describe('the phone and tablet builds', () => {
  const ios = json('tauri.ios.conf.json');
  const android = json('tauri.android.conf.json');

  it('open invitation links from the router', () => {
    for (const config of [ios, android]) {
      expect(config.plugins['deep-link'].mobile).toContainEqual(
        expect.objectContaining({ host: routerHost, pathPrefix: [ROUTER_PATH], appLink: true }),
      );
    }
  });

  it('claim the router in the iOS entitlements', () => {
    expect(read('gen/apple/worship-q_iOS/worship-q_iOS.entitlements')).toContain(
      `<string>applinks:${routerHost}</string>`,
    );
  });

  it('are the apps the router names (N32)', () => {
    const team = ios.bundle.iOS?.developmentTeam;
    expect(ios.identifier).toBe('com.worship-q.app');
    expect(android.identifier).toBe('com.worship-q.app');
    const apple = JSON.parse(
      readFileSync(
        resolve(__dirname, '../../router/public/.well-known/apple-app-site-association'),
        'utf8',
      ),
    );
    expect(apple.applinks.details[0].appIDs).toEqual([`${team}.${ios.identifier}`]);
    const google = JSON.parse(
      readFileSync(resolve(__dirname, '../../router/public/.well-known/assetlinks.json'), 'utf8'),
    );
    // Tauri turns the hyphen into an underscore, as Android package names need.
    expect(google[0].target.package_name).toBe('com.worship_q.app');
  });

  it('say why they ask for each permission on iOS', () => {
    const plist = read('Info.ios.plist');
    for (const key of [
      'NSLocalNetworkUsageDescription',
      'NSCameraUsageDescription',
      'NSMicrophoneUsageDescription',
    ]) {
      expect(plist).toMatch(new RegExp(`<key>${key}</key>\\s*<string>[^<]+</string>`));
    }
    expect(plist).toMatch(/<key>NSBonjourServices<\/key>\s*<array>\s*<string>_worship-q\._tcp/);
  });

  it('ask Android for the venue network, the camera and the microphone', () => {
    const manifest = read('gen/android/app/src/main/AndroidManifest.xml');
    for (const permission of [
      'ACCESS_LOCAL_NETWORK',
      'CHANGE_WIFI_MULTICAST_STATE',
      'CAMERA',
      'RECORD_AUDIO',
    ]) {
      expect(manifest).toContain(`android.permission.${permission}`);
    }
    expect(manifest).not.toContain('LEANBACK');
  });
});
