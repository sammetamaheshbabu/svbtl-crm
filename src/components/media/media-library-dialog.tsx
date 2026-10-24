"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, Film, Library as LibraryIcon, Loader2, Mic, Search, Upload } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  LIBRARY_BUCKET,
  fitsAccept,
  kindFromMime,
  listLibrary,
  type LibraryAccept,
  type LibraryFile,
  type LibraryTab,
} from "@/lib/storage/media-library";
import { uploadAccountMedia } from "@/lib/storage/upload-media";

/** Tiles shown before "Load more". */
const PAGE = 60;

const KIND_ICON = { video: Film, audio: Mic, document: FileText } as const;

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

interface MediaLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Only files this caller can use are shown. */
  accept: LibraryAccept;
  onPick: (file: LibraryFile) => void;
}

/**
 * Pick a file the account already has in storage — our uploads or media
 * customers sent — or upload a new one into the library. Never deletes.
 */
export function MediaLibraryDialog({ open, onOpenChange, accept, onPick }: MediaLibraryDialogProps) {
  const t = useTranslations("MediaLibrary");
  const { accountId } = useAuth();
  const [tab, setTab] = useState<LibraryTab>("ours");
  const [files, setFiles] = useState<LibraryFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [uploading, setUploading] = useState(false);
  const [reload, setReload] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    void listLibrary(createClient(), accountId, tab)
      .then((list) => !cancelled && (setFiles(list), setError(null)))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
      setFiles(null);
    };
  }, [open, accountId, tab, reload]);

  const usable = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (files ?? []).filter((f) => fitsAccept(f, accept) && f.name.toLowerCase().includes(q));
  }, [files, accept, search]);

  const pick = (file: LibraryFile) => {
    onPick(file);
    onOpenChange(false);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const asLibraryFile = { kind: kindFromMime(file.type), mimeType: file.type, size: file.size };
    if (!fitsAccept(asLibraryFile, accept)) {
      setError(t("uploadNotAllowed"));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const { publicUrl, path } = await uploadAccountMedia(LIBRARY_BUCKET, file);
      pick({ ...asLibraryFile, url: publicUrl, path, name: file.name, createdAt: new Date().toISOString() });
      setReload((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const switchTab = (next: LibraryTab) => {
    setTab(next);
    setShown(PAGE);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90dvh] max-h-[90dvh] flex-col gap-3 sm:h-[80vh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          {(["ours", "received"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => switchTab(key)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-medium",
                tab === key
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {t(key === "ours" ? "tabOurs" : "tabReceived")}
            </button>
          ))}
          <div className="relative min-w-40 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("search")}
              className="h-8 border-border bg-muted pl-8 text-base sm:text-xs"
            />
          </div>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="h-8"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {t("upload")}
          </Button>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {files === null ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : usable.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {files.length === 0 ? t(tab === "ours" ? "emptyOurs" : "emptyReceived") : t("noMatch")}
            </p>
          ) : (
            <>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {usable.slice(0, shown).map((file) => {
                  const Icon = file.kind === "image" ? null : KIND_ICON[file.kind];
                  return (
                    <li key={file.path}>
                      <button
                        type="button"
                        onClick={() => pick(file)}
                        title={file.name}
                        className="group flex w-full flex-col overflow-hidden rounded-lg border border-border bg-muted/40 text-left hover:border-primary/60"
                      >
                        <span className="flex aspect-square w-full items-center justify-center bg-muted">
                          {Icon ? (
                            <Icon className="h-8 w-8 text-muted-foreground" />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={file.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                          )}
                        </span>
                        <span className="w-full truncate px-2 pt-1.5 text-[11px] text-foreground">{file.name}</span>
                        <span className="px-2 pb-1.5 text-[10px] text-muted-foreground">{formatSize(file.size)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {usable.length > shown && (
                <div className="flex justify-center py-3">
                  <Button type="button" variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>
                    {t("loadMore", { count: usable.length - shown })}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A "Library" button that opens the picker; for media-link fields. */
export function MediaLibraryButton({
  accept,
  onPick,
  className,
}: {
  accept: LibraryAccept;
  onPick: (file: LibraryFile) => void;
  className?: string;
}) {
  const t = useTranslations("MediaLibrary");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className={cn("h-9 shrink-0", className)}
      >
        <LibraryIcon className="h-4 w-4" />
        {t("button")}
      </Button>
      <MediaLibraryDialog open={open} onOpenChange={setOpen} accept={accept} onPick={onPick} />
    </>
  );
}
