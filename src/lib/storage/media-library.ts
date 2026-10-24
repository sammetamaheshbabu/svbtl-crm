// ============================================================
// Media Library — files already in the `chat-media` bucket, so staff can
// send one again instead of uploading it twice.
//
// Layout (see buildMediaPath / mirror-inbound-media):
//   chat-media/account-<id>/<timestamp>-<name>.<ext>        our uploads
//   chat-media/account-<id>/<folder>/…                      e.g. quick-replies
//   chat-media/account-<id>/inbound/…                       customer media
//
// "Our files" is the account folder plus one level into each subfolder
// except `inbound`; "Received" is `inbound`. Listing runs under the
// caller's session — the bucket's read policy (migration 043) limits it to
// their own account folder. Nothing here deletes: a library file may be in
// use by sent messages or quick replies.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { MEDIA_MAX_BYTES_BY_KIND } from './upload-media';

export const LIBRARY_BUCKET = 'chat-media';
const INBOUND_FOLDER = 'inbound';
/** Storage lists at most this many objects per call; plenty per folder. */
const LIST_LIMIT = 1000;

export type LibraryKind = 'image' | 'video' | 'audio' | 'document';
export type LibraryTab = 'ours' | 'received';

export interface LibraryFile {
  /** Public link Meta can fetch. */
  url: string;
  /** Object path inside the bucket. */
  path: string;
  /** File name without the upload timestamp. */
  name: string;
  mimeType: string;
  size: number;
  kind: LibraryKind;
  createdAt: string;
}

/** What a caller can use: kinds, optionally narrowed to exact MIME types. */
export interface LibraryAccept {
  kinds: LibraryKind[];
  mimeTypes?: string[];
}

export function kindFromMime(mimeType: string): LibraryKind {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

/** "1792292777596-SVB_Profile.pdf" → "SVB_Profile.pdf". */
export function displayName(objectName: string): string {
  const base = objectName.split('/').pop() ?? objectName;
  return base.replace(/^\d{10,}-/, '') || base;
}

/** True when the file is a usable kind and type, and within Meta's size cap. */
export function fitsAccept(file: Pick<LibraryFile, 'kind' | 'mimeType' | 'size'>, accept: LibraryAccept): boolean {
  if (!accept.kinds.includes(file.kind)) return false;
  if (accept.mimeTypes && !accept.mimeTypes.includes(file.mimeType)) return false;
  return file.size <= MEDIA_MAX_BYTES_BY_KIND[file.kind];
}

/**
 * What a template's media header accepts, by `header_type` (Meta: image
 * JPEG/PNG, video MP4, document PDF).
 */
export function acceptForHeader(headerType: string | null | undefined): LibraryAccept | null {
  switch (headerType) {
    case 'image':
      return { kinds: ['image'], mimeTypes: ['image/jpeg', 'image/png'] };
    case 'video':
      return { kinds: ['video'], mimeTypes: ['video/mp4'] };
    case 'document':
      return { kinds: ['document'], mimeTypes: ['application/pdf'] };
    default:
      return null;
  }
}

interface StorageEntry {
  name: string;
  id: string | null;
  created_at: string | null;
  metadata: { size?: number; mimetype?: string } | null;
}

async function listFolder(db: SupabaseClient, folder: string): Promise<StorageEntry[]> {
  const { data, error } = await db.storage.from(LIBRARY_BUCKET).list(folder, {
    limit: LIST_LIMIT,
    sortBy: { column: 'created_at', order: 'desc' },
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as StorageEntry[];
}

/** The tab's files, newest first. */
export async function listLibrary(
  db: SupabaseClient,
  accountId: string,
  tab: LibraryTab
): Promise<LibraryFile[]> {
  const root = `account-${accountId}`;
  const folders: string[] = [];
  const files: { folder: string; entry: StorageEntry }[] = [];

  if (tab === 'received') {
    folders.push(`${root}/${INBOUND_FOLDER}`);
  } else {
    for (const entry of await listFolder(db, root)) {
      // Folders come back without an id.
      if (entry.id === null) {
        if (entry.name !== INBOUND_FOLDER) folders.push(`${root}/${entry.name}`);
      } else {
        files.push({ folder: root, entry });
      }
    }
  }
  for (const folder of folders) {
    for (const entry of await listFolder(db, folder)) {
      if (entry.id !== null) files.push({ folder, entry });
    }
  }

  return files
    .map(({ folder, entry }) => {
      const path = `${folder}/${entry.name}`;
      const mimeType = entry.metadata?.mimetype ?? 'application/octet-stream';
      return {
        url: db.storage.from(LIBRARY_BUCKET).getPublicUrl(path).data.publicUrl,
        path,
        name: displayName(entry.name),
        mimeType,
        size: entry.metadata?.size ?? 0,
        kind: kindFromMime(mimeType),
        createdAt: entry.created_at ?? '',
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
