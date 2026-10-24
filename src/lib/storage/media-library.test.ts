import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  acceptForHeader,
  displayName,
  fitsAccept,
  kindFromMime,
  listLibrary,
} from './media-library';

const MB = 1024 * 1024;

describe('library helpers', () => {
  it('maps MIME types to kinds', () => {
    expect(kindFromMime('image/png')).toBe('image');
    expect(kindFromMime('video/mp4')).toBe('video');
    expect(kindFromMime('audio/ogg')).toBe('audio');
    expect(kindFromMime('application/pdf')).toBe('document');
  });

  it('drops the upload timestamp from names', () => {
    expect(displayName('1792292777596-SVB_TechLabs_Profile.pdf')).toBe('SVB_TechLabs_Profile.pdf');
    expect(displayName('account-x/quick-replies/studio-website.jpg')).toBe('studio-website.jpg');
    expect(displayName('2026-plan.pdf')).toBe('2026-plan.pdf');
  });

  it('checks kind, type and size', () => {
    const header = acceptForHeader('image')!;
    expect(fitsAccept({ kind: 'image', mimeType: 'image/jpeg', size: MB }, header)).toBe(true);
    expect(fitsAccept({ kind: 'image', mimeType: 'image/webp', size: MB }, header)).toBe(false);
    expect(fitsAccept({ kind: 'image', mimeType: 'image/png', size: 6 * MB }, header)).toBe(false);
    expect(fitsAccept({ kind: 'video', mimeType: 'video/mp4', size: MB }, header)).toBe(false);
    const any = { kinds: ['image', 'video', 'audio', 'document'] as const };
    expect(fitsAccept({ kind: 'document', mimeType: 'application/pdf', size: 10 * MB }, { kinds: [...any.kinds] })).toBe(true);
  });

  it('knows what each template header takes', () => {
    expect(acceptForHeader('video')).toEqual({ kinds: ['video'], mimeTypes: ['video/mp4'] });
    expect(acceptForHeader('document')?.mimeTypes).toEqual(['application/pdf']);
    expect(acceptForHeader('text')).toBeNull();
  });
});

// Storage stub: folder → entries; records which folders were listed.
function makeDb(tree: Record<string, object[]>, listed: string[]): SupabaseClient {
  return {
    storage: {
      from: () => ({
        list: async (folder: string) => {
          listed.push(folder);
          return { data: tree[folder] ?? [], error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn/${path}` } }),
      }),
    },
  } as unknown as SupabaseClient;
}

const file = (name: string, created: string, mimetype = 'image/jpeg', size = 1000) => ({
  name,
  id: name,
  created_at: created,
  metadata: { mimetype, size },
});
const folder = (name: string) => ({ name, id: null, created_at: null, metadata: null });

const tree = {
  'account-a': [
    folder('quick-replies'),
    folder('inbound'),
    file('1792292777596-Profile.pdf', '2026-10-18T03:06:00Z', 'application/pdf'),
  ],
  'account-a/quick-replies': [file('studio-website.jpg', '2026-10-24T10:00:00Z')],
  'account-a/inbound': [file('wamid-1.jpg', '2026-10-20T08:00:00Z')],
};

describe('listLibrary', () => {
  it('lists our files across subfolders, without customer media', async () => {
    const listed: string[] = [];
    const files = await listLibrary(makeDb(tree, listed), 'a', 'ours');
    expect(files.map((f) => f.name)).toEqual(['studio-website.jpg', 'Profile.pdf']);
    expect(listed).toEqual(['account-a', 'account-a/quick-replies']);
    expect(files[0]).toMatchObject({
      path: 'account-a/quick-replies/studio-website.jpg',
      url: 'https://cdn/account-a/quick-replies/studio-website.jpg',
      kind: 'image',
    });
    expect(files[1].kind).toBe('document');
  });

  it('lists customer media on its own tab', async () => {
    const listed: string[] = [];
    const files = await listLibrary(makeDb(tree, listed), 'a', 'received');
    expect(files.map((f) => f.path)).toEqual(['account-a/inbound/wamid-1.jpg']);
    expect(listed).toEqual(['account-a/inbound']);
  });
});
