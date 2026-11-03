/**
 * The admin web app's view of the instance (phase 3). These routes live under
 * `/api/v1/admin/` and `/auth/`, are authenticated by the administrator's session cookie
 * rather than a device token, and are refused without the `ADMIN_HEADER` (decision D35).
 */
import type { LiveSnapshot, SyncKind } from './wire';

/** Every admin request carries this header, so a cross-site form cannot reach the routes. */
export const ADMIN_HEADER = 'x-worship-q-admin';

/** `GET /api/v1/admin/me`: whether sign-in is configured, and who is signed in. */
export interface AdminMe {
  /** The instance has an OIDC provider configured (D27). */
  configured: boolean;
  /** At least one administrator exists, so connection codes are off unless turned on (D30). */
  hasAdministrators: boolean;
  admin: { id: string; email: string; name: string | null } | null;
  /** The instance's name, for the page title. */
  name: string;
}

export interface AdminAdministrator {
  id: string;
  email: string;
  name: string | null;
  /** E-mail of the administrator who added this one; null when added at deployment. */
  addedBy: string | null;
  createdAt: string;
  lastSignInAt: string | null;
}

export interface AdminWorkspace {
  id: string;
  name: string;
  /** Null until a device uploaded content. */
  contentId: string | null;
  manageLibrary: boolean;
  /** Whether its connection code works although administrators exist (D30). */
  codesEnabled: boolean;
  devices: number;
  createdAt: string;
  /** A live state is kept for it right now. */
  live: boolean;
}

export type EnrolledBy = 'code' | 'pairing';

export interface AdminDevice {
  id: string;
  workspaceId: string;
  workspaceName: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  enrolledBy: EnrolledBy;
  /** E-mail of the administrator who approved the pairing, when it was one. */
  approvedBy: string | null;
  /** Connected to the relay right now. */
  connected: boolean;
}

export interface AdminPairingRequest {
  code: string;
  deviceName: string;
  createdAt: string;
  expiresAt: string;
}

/** What turning Manage Church Library on would do (D36). */
export interface AdminLibraryPlan {
  songs: string[];
  backgrounds: string[];
  overrides: {
    title: string;
    /** The church's song changed after the workspace made its version. */
    churchChangedSince: boolean;
    /** The workspace chose the church's version (D32); its own is dropped, not promoted. */
    usesChurchVersion: boolean;
  }[];
  hidden: string[];
}

/** A workspace's live state as the server last heard of it (D38). */
export type AdminLiveView =
  | { live: false }
  | {
      live: true;
      snapshot: LiveSnapshot;
      coordinator: { deviceId: string; name: string | null; connected: boolean };
      /** When the snapshot last arrived. */
      updatedAt: string;
      /** When the live state expires with no operator device connected (D6). */
      expiresAt: string;
    };

export type LibraryKind = Extract<SyncKind, 'song' | 'background'>;

/** A song or background of the Church Library as the admin app lists it. */
export interface AdminLibraryItem {
  kind: LibraryKind;
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  removedAt: string | null;
  /** Set once the retention sweep removed its files (D34); null while they can be restored. */
  filesRemovedAt: string | null;
  /** Where the record last came from. */
  fromWorkspace: { id: string; name: string } | null;
  /**
   * Who deleted it: an administrator in the app, or a workspace that manages the Church
   * Library (D34). Null while not deleted, or when not known.
   */
  deletedBy: { administrator: string } | { workspace: { id: string; name: string } } | null;
  /** Shown by a background's file name or a deck's; null for a lyrics song. */
  fileName: string | null;
}

/** Which workspaces' run sheets use an item (D37). */
export interface AdminLibraryUsage {
  workspaces: { id: string; name: string; dates: string[] }[];
}

export type StorageType =
  | 'deckImages'
  | 'deckOriginals'
  | 'backgroundImages'
  | 'backgroundVideos'
  | 'backups'
  | 'database'
  | 'other';

export interface StorageTotal {
  bytes: number;
  files: number;
}

/** `GET /api/v1/admin/storage` (media plan U11). */
export interface AdminStorage {
  /** Free and total space on the data volume. */
  volume: { freeBytes: number; totalBytes: number };
  totals: Record<StorageType, StorageTotal>;
  /** The Church Library's files are listed under `church`. */
  workspaces: { id: string; name: string; totals: Record<StorageType, StorageTotal> }[];
  /** Deck originals of songs removed or not used in six months (media plan U5). */
  prunableDeckOriginals: StorageTotal;
}
