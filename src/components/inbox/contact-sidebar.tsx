"use client";

import { useState, useEffect, useCallback, useId } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { cn } from "@/lib/utils";
import type { Contact, CustomField, Deal, ContactNote, Tag } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  Pencil,
  X,
  Building2,
  Loader2,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { contactHandle } from "@/lib/whatsapp/wa-identity";
import { addContactTag, deleteContactTag } from "@/lib/contacts/tag-api";
import { saveContactProfile, ProfileError } from "@/lib/contacts/save-profile";

interface ContactSidebarProps {
  contact: Contact | null;
  /** A saved profile edit, so the list and thread header show the new name. */
  onContactUpdated?: (contact: Contact) => void;
  /** "panel": the desktop right-hand column. "sheet": inside the phone sheet. */
  variant?: "panel" | "sheet";
}

type ContactTagRow = Tag & { contact_tag_id: string };

function mapContactTags(rows: Record<string, unknown>[]): ContactTagRow[] {
  return rows
    .filter((ct) => ct.tags)
    .map((ct) => ({ ...(ct.tags as Tag), contact_tag_id: ct.id as string }));
}

export function ContactSidebar({
  contact,
  onContactUpdated,
  variant = "panel",
}: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");

  const { accountId } = useAuth();
  // Editing a contact needs the agent role, like sending (contacts RLS).
  const canEdit = useCan("send-messages");
  const [copied, setCopied] = useState(false);
  /** Keeps this instance's realtime topic distinct from a second sidebar's. */
  const instanceId = useId();

  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<ContactTagRow[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  // Custom fields: definitions + this contact's values.
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  // Profile edit form.
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", company: "" });
  const [formCustom, setFormCustom] = useState<Record<string, string>>({});

  // Tag picker: the account's tags, loaded when it opens.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allTags, setAllTags] = useState<Tag[] | null>(null);
  const [tagSearch, setTagSearch] = useState("");
  const [busyTagId, setBusyTagId] = useState<string | null>(null);

  const contactId = contact?.id;

  const fetchTags = useCallback(async () => {
    if (!contactId) return;
    const { data } = await createClient()
      .from("contact_tags")
      .select("id, tag_id, tags(*)")
      .eq("contact_id", contactId);
    if (data) setTags(mapContactTags(data));
  }, [contactId]);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, tags and custom fields in parallel
    const [dealsRes, notesRes, tagsRes, fieldsRes, valuesRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
      supabase.from("custom_fields").select("*").order("field_name"),
      supabase
        .from("contact_custom_values")
        .select("custom_field_id, value")
        .eq("contact_id", contact.id),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) setTags(mapContactTags(tagsRes.data));
    if (fieldsRes.data) setCustomFields(fieldsRes.data as CustomField[]);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      for (const v of valuesRes.data) map[v.custom_field_id] = v.value ?? "";
      setCustomValues(map);
    }
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  // Another chat opened: drop a half-finished edit.
  useEffect(() => {
    setEditing(false);
  }, [contactId]);

  // Automations tag customers while the chat is open (a tapped "Arrange
  // a Call Back", a named service). contact_tags isn't on the realtime
  // publication, but every such automation sends a reply right after
  // tagging, which updates the conversation row — so re-read the tags
  // whenever this contact's conversation changes. Debounced: one send
  // can touch the row more than once.
  useEffect(() => {
    if (!contactId) return;
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
  // The topic carries this instance's id, not just the contact's. Below xl the
  // chat header opens the sheet while the panel copy of this component is still
  // mounted (hidden by CSS alone), so two sidebars watch the same contact at
  // once. supabase.channel() hands back the *existing* channel for a repeated
  // topic, and .on() on an already-subscribed channel throws — which crashed
  // the inbox when a phone tapped the customer's name. A per-instance topic
  // also survives the mount→unmount→remount of StrictMode, since
  // removeChannel() only finishes unregistering the old topic asynchronously.
    const channel = supabase
      .channel(`contact-tags:${contactId}:${instanceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `contact_id=eq.${contactId}`,
        },
        () => {
          clearTimeout(timer);
          timer = setTimeout(() => void fetchTags(), 400);
        }
      )
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [contactId, fetchTags, instanceId]);

  const startEditing = useCallback(() => {
    if (!contact) return;
    setForm({
      name: contact.name ?? "",
      email: contact.email ?? "",
      company: contact.company ?? "",
    });
    setFormCustom(
      Object.fromEntries(customFields.map((f) => [f.id, customValues[f.id] ?? ""])),
    );
    setEditing(true);
  }, [contact, customFields, customValues]);

  const saveProfile = useCallback(async () => {
    if (!contact) return;
    setSaving(true);
    try {
      const saved = await saveContactProfile(createClient(), contact.id, {
        ...form,
        customValues: formCustom,
      });
      setCustomValues((prev) => {
        const next = { ...prev };
        for (const [id, value] of Object.entries(formCustom)) next[id] = value.trim();
        return next;
      });
      setEditing(false);
      toast.success(tSidebar("profileSaved"));
      onContactUpdated?.(saved);
    } catch (err) {
      toast.error(
        err instanceof ProfileError && err.message === "invalid_email"
          ? tSidebar("invalidEmail")
          : tSidebar("profileSaveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }, [contact, form, formCustom, onContactUpdated, tSidebar]);

  const openTagPicker = useCallback(
    async (open: boolean) => {
      setPickerOpen(open);
      setTagSearch("");
      if (!open) return;
      const { data } = await createClient().from("tags").select("*").order("name");
      setAllTags((data as Tag[]) ?? []);
    },
    [],
  );

  // Adding goes through the tags API, which also fires "Tag added"
  // automations (department routing), same as the Contacts page.
  const addTag = useCallback(
    async (tag: Tag) => {
      if (!contact) return;
      setBusyTagId(tag.id);
      try {
        await addContactTag(contact.id, tag.id);
        setPickerOpen(false);
        await fetchContactData();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : tSidebar("tagFailed"));
      } finally {
        setBusyTagId(null);
      }
    },
    [contact, fetchContactData, tSidebar],
  );

  const removeTag = useCallback(
    async (tag: ContactTagRow) => {
      if (!contact) return;
      setBusyTagId(tag.id);
      try {
        await deleteContactTag(contact.id, tag.id);
        setTags((prev) => prev.filter((t) => t.id !== tag.id));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : tSidebar("tagFailed"));
      } finally {
        setBusyTagId(null);
      }
    },
    [contact, tSidebar],
  );

  const handleCopyPhone = useCallback(async () => {
    // Copies whatever the row displays — a BSUID-only contact has no
    // phone number to copy, but its @username still identifies them.
    const handle = contact ? contactHandle(contact) : '';
    if (!handle) return;
    await navigator.clipboard.writeText(handle);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  if (!contact) {
    return (
      <div className={cn("flex h-full items-center justify-center bg-card", variant === "panel" && "w-70 border-l border-border")}>
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contactHandle(contact);
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className={cn("flex h-full flex-col bg-card", variant === "panel" && "w-70 border-l border-border")}>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <div className="mt-3 flex items-center gap-1">
              <h3 className="text-sm font-semibold text-foreground">{displayName}</h3>
              {canEdit && !editing && (
                <button
                  type="button"
                  onClick={startEditing}
                  aria-label={tSidebar("editProfile")}
                  title={tSidebar("editProfile")}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {contact.company && !editing && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {editing && (
            <div className="mt-4 space-y-3 rounded-lg border border-border bg-background/50 p-3">
              {(
                [
                  ["name", tSidebar("nameLabel"), "text"],
                  ["email", tSidebar("emailLabel"), "email"],
                  ["company", tSidebar("companyLabel"), "text"],
                ] as const
              ).map(([key, label, type]) => (
                <label key={key} className="block space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
                  <Input
                    type={type}
                    value={form[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="h-9 border-border bg-muted text-base text-foreground sm:text-sm"
                  />
                </label>
              ))}
              {customFields.map((field) => (
                <label key={field.id} className="block space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground">{field.field_name}</span>
                  <Input
                    value={formCustom[field.id] ?? ""}
                    onChange={(e) => setFormCustom((c) => ({ ...c, [field.id]: e.target.value }))}
                    className="h-9 border-border bg-muted text-base text-foreground sm:text-sm"
                  />
                </label>
              ))}
              <p className="text-[11px] text-muted-foreground">{tSidebar("phoneReadOnly")}</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                >
                  {tSidebar("cancel")}
                </Button>
                <Button
                  size="sm"
                  className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={saveProfile}
                  disabled={saving}
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {tSidebar("save")}
                </Button>
              </div>
            </div>
          )}

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left">
                {contactHandle(contact)}
              </span>
              {copied ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
            {contact.company && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.company}</span>
              </div>
            )}
            {customFields
              .filter((f) => customValues[f.id])
              .map((f) => (
                <div key={f.id} className="px-3 text-xs">
                  <span className="text-muted-foreground">{f.field_name}: </span>
                  <span className="text-foreground">{customValues[f.id]}</span>
                </div>
              ))}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              <span className="flex-1">{tSidebar("tags")}</span>
              {canEdit && (
                <Popover open={pickerOpen} onOpenChange={(open) => void openTagPicker(open)}>
                  <PopoverTrigger
                    aria-label={tSidebar("addTag")}
                    title={tSidebar("addTag")}
                    className="flex h-6 w-6 items-center justify-center rounded-md normal-case text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64 p-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={tagSearch}
                        onChange={(e) => setTagSearch(e.target.value)}
                        placeholder={tSidebar("searchTags")}
                        className="h-8 border-border bg-muted pl-8 text-base sm:text-xs"
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {allTags === null ? (
                        <div className="flex justify-center py-3">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : (
                        (() => {
                          const attached = new Set(tags.map((t) => t.id));
                          const q = tagSearch.trim().toLowerCase();
                          const options = allTags.filter(
                            (t) => !attached.has(t.id) && t.name.toLowerCase().includes(q),
                          );
                          if (options.length === 0) {
                            return (
                              <p className="px-2 py-3 text-xs text-muted-foreground">
                                {allTags.length === 0 ? tSidebar("noTagsDefined") : tSidebar("noMoreTags")}
                              </p>
                            );
                          }
                          return options.map((tag) => (
                            <button
                              key={tag.id}
                              type="button"
                              disabled={busyTagId !== null}
                              onClick={() => void addTag(tag)}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                            >
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                              <span className="flex-1 truncate text-popover-foreground">{tag.name}</span>
                              {busyTagId === tag.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            </button>
                          ));
                        })()
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noTags")}</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-[11px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => void removeTag(tag)}
                        disabled={busyTagId !== null}
                        aria-label={tSidebar("removeTag", { name: tag.name })}
                        title={tSidebar("removeTag", { name: tag.name })}
                        className="flex h-4 w-4 items-center justify-center rounded-full opacity-70 hover:bg-black/10 hover:opacity-100 disabled:opacity-40"
                      >
                        {busyTagId === tag.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <X className="h-3 w-3" />
                        )}
                      </button>
                    )}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              {tSidebar("deals")}
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noDeals")}</p>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar("addNotePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
