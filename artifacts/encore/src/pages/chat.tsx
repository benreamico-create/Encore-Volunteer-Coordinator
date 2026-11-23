import { useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  getGetEventAnnouncementQueryKey,
  getGetEventQueryKey,
  getListEventMessagesQueryKey,
  useCreateEventAnnouncement,
  useCreateEventMessage,
  useDeleteEventMessage,
  useDraftAnnouncement,
  useGetEvent,
  useGetEventAnnouncement,
  useListEventMessages,
  type Announcement,
  type AnnouncementDraft,
  type TeamMessage,
} from "@workspace/api-client-react";
import { Shell, PageHeader } from "@/components/shell";
import { ErrorPanel, Icon, Skel } from "@/components/brand";
import { copyText, errorMessage, errorStatus, fmtInTz } from "@/lib/encore";
import { useEncore } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel } from "@/components/ui/form";

function timeLabel(value: string, timezone: string) {
  return fmtInTz(value, timezone, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const messageSchema = z.object({ body: z.string().trim().min(1).max(2000) });
const announcementSchema = z.object({ body: z.string().trim().min(1).max(500) });

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const qc = useQueryClient();
  const { session } = useEncore();
  const { toast } = useToast();
  const userId = session?.user?.id;
  const eventQuery = useGetEvent(id, { query: { enabled: !!id, queryKey: getGetEventQueryKey(id) } });
  const [after, setAfter] = useState(0);
  const [feed, setFeed] = useState<TeamMessage[]>([]);
  const messageForm = useForm<{ body: string }>({
    resolver: zodResolver(messageSchema),
    defaultValues: { body: "" },
  });
  const announcementForm = useForm<{ body: string }>({
    resolver: zodResolver(announcementSchema),
    defaultValues: { body: "" },
  });
  const messageText = messageForm.watch("body");
  const announcementText = announcementForm.watch("body");
  const [draft, setDraft] = useState<AnnouncementDraft | null>(null);
  const [draftError, setDraftError] = useState("");
  const [messageError, setMessageError] = useState("");
  const [announcementError, setAnnouncementError] = useState("");
  const messagesQuery = useListEventMessages(id, { after }, {
    query: {
      enabled: !!id,
      queryKey: getListEventMessagesQueryKey(id, { after }),
      refetchInterval: 5000,
      refetchIntervalInBackground: false,
    },
  });
  const announcementQuery = useGetEventAnnouncement(id, {
    query: {
      enabled: !!id,
      queryKey: getGetEventAnnouncementQueryKey(id),
      refetchInterval: 5000,
      refetchIntervalInBackground: false,
    },
  });
  const sendMessage = useCreateEventMessage();
  const deleteMessage = useDeleteEventMessage();
  const postAnnouncement = useCreateEventAnnouncement();
  const draftAnnouncement = useDraftAnnouncement();
  const event = eventQuery.data?.event;
  const chatKey = getListEventMessagesQueryKey(id, { after });
  const announcementKey = getGetEventAnnouncementQueryKey(id);
  const organizerCount = eventQuery.data?.organizers.length ?? 1;
  const orderedFeed = useMemo(() => [...feed].sort((a, b) => a.id - b.id), [feed]);

  useEffect(() => {
    setAfter(0);
    setFeed([]);
    messageForm.reset();
    announcementForm.reset();
    setDraft(null);
  }, [id]);

  useEffect(() => {
    if (!messagesQuery.data) return;
    setFeed((current) => {
      const byId = new Map(current.map((message) => [message.id, message]));
      messagesQuery.data?.forEach((message) => byId.set(message.id, message));
      return Array.from(byId.values()).sort((a, b) => a.id - b.id);
    });
    const greatestId = messagesQuery.data.reduce((max, message) => Math.max(max, message.id), after);
    if (greatestId > after) setAfter(greatestId);
  }, [messagesQuery.data, after]);

  const submitMessage = messageForm.handleSubmit(({ body }) => {
    setMessageError("");
    sendMessage.mutate({ id, data: { body } }, {
      onSuccess: (created) => {
        setFeed((current) => [...current.filter((item) => item.id !== created.id), created].sort((a, b) => a.id - b.id));
        messageForm.reset();
        setAfter((current) => Math.max(current, created.id));
        void qc.invalidateQueries({ queryKey: getListEventMessagesQueryKey(id) });
      },
      onError: (error) => setMessageError(errorMessage(error, "The message could not be sent. Try again.")),
    });
  });

  const removeMessage = (message: TeamMessage) => {
    if (!window.confirm("Delete this message?")) return;
    deleteMessage.mutate({ id, itemId: message.id }, {
      onSuccess: (deleted) => {
        setFeed((current) => current.map((item) => item.id === deleted.id ? deleted : item));
        qc.setQueryData<TeamMessage[]>(chatKey, (current) => current?.map((item) => item.id === deleted.id ? deleted : item));
        void qc.invalidateQueries({ queryKey: getListEventMessagesQueryKey(id) });
      },
      onError: (error) => toast({ title: "Could not delete message", description: errorMessage(error), variant: "destructive" }),
    });
  };

  const createAnnouncement = announcementForm.handleSubmit(({ body }) => {
    setAnnouncementError("");
    postAnnouncement.mutate({ id, data: { body } }, {
      onSuccess: (created: Announcement) => {
        qc.setQueryData<Announcement | null>(announcementKey, created);
        announcementForm.reset();
        setDraft(null);
        toast({ title: "Announcement posted", description: "Volunteers will see the latest update on their private page." });
        void qc.invalidateQueries({ queryKey: announcementKey });
      },
      onError: (error) => setAnnouncementError(errorMessage(error, "The announcement could not be posted. Try again.")),
    });
  });

  const makeDraft = () => {
    setDraftError("");
    draftAnnouncement.mutate({ data: { event_id: id } }, {
      onSuccess: (result) => {
        setDraft(result);
      announcementForm.setValue("body", result.body.slice(0, 500), { shouldDirty: true, shouldValidate: true });
      },
      onError: (error) => setDraftError(errorMessage(error, "A draft could not be made. Try again.")),
    });
  };

  const copyAnnouncement = async () => {
    const text = announcementText.trim() || announcementQuery.data?.body || "";
    if (!text) {
      toast({ title: "Nothing to copy", description: "Write or draft an announcement first." });
      return;
    }
    toast((await copyText(text)) ? { title: "Announcement text copied" } : { title: "Could not copy text", description: "Your browser did not allow clipboard access.", variant: "destructive" });
  };

  const eventName = event?.name ?? "Event coordination";
  if (eventQuery.isLoading) {
    return <Shell><div data-testid="status-loading-chat-page"><Skel className="h-10 w-72 mb-3" /><Skel className="h-4 w-56 mb-8" /><div className="grid lg:grid-cols-[1fr_360px] gap-5"><Skel className="h-[540px] !rounded-2xl" /><Skel className="h-[420px] !rounded-2xl" /></div></div></Shell>;
  }
  if (eventQuery.isError || !event) {
    const notFound = errorStatus(eventQuery.error) === 404 || errorStatus(eventQuery.error) === 403;
    return <Shell><ErrorPanel title={notFound ? "Event not found" : "Chat could not load"} message={notFound ? "This event does not exist or belongs to your account." : errorMessage(eventQuery.error)} onRetry={notFound ? undefined : () => void eventQuery.refetch()} /></Shell>;
  }

  return (
    <Shell event={{ id, name: event.name }}>
      <PageHeader eyebrow="Event-day coordination" title="Chat" subtitle={`${event.name} · team channel and volunteer announcements`} />
      <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
        <section className="glass !p-0 overflow-hidden flex flex-col min-h-[560px]" data-testid="panel-team-chat">
          <header className="flex items-center justify-between gap-3 px-5 py-4 border-b" style={{ borderColor: "var(--line)" }}>
            <div><div className="mono-label">Team channel</div><h2 className="font-display text-[20px] mt-1" data-testid="text-chat-event-name">{eventName}</h2></div>
            <span className="chip chip-auto"><span className="w-1.5 h-1.5 rounded-full bg-[#37442E]" />{organizerCount} organizer{organizerCount === 1 ? "" : "s"}</span>
          </header>
          <div className="flex-1 px-4 py-4 sm:px-5 space-y-3 max-h-[58dvh] min-h-[240px] overflow-y-auto" aria-live="polite" data-testid="list-team-messages">
            {messagesQuery.isLoading && feed.length === 0 ? <div className="space-y-3" data-testid="status-loading-messages"><Skel className="h-20 w-4/5" /><Skel className="h-16 w-3/5 ml-auto" /><Skel className="h-24 w-4/5" /></div>
              : messagesQuery.isError && feed.length === 0 ? <div className="rounded-2xl border border-dashed p-6 text-center" role="alert" data-testid="status-error-messages"><p className="font-semibold">Messages could not load</p><p className="text-[13px] text-muted-ink mt-1">{errorMessage(messagesQuery.error)}</p><button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => void messagesQuery.refetch()} data-testid="button-retry-messages">Try again</button></div>
                : orderedFeed.length === 0 ? <div className="h-full min-h-[230px] flex flex-col items-center justify-center text-center px-6" data-testid="status-empty-messages"><span className="w-12 h-12 rounded-2xl grid place-items-center mb-3" style={{ background: "rgba(55,68,46,.08)", color: "var(--forest)" }}><Icon name="chat" size={22} /></span><p className="font-display text-[21px]">A clear channel.</p><p className="text-[13px] text-muted-ink mt-1 max-w-[280px]">Share a quick update with the organizing team. Volunteers do not need accounts to get event updates.</p></div>
                  : orderedFeed.map((message) => {
                    const own = message.user_id === userId;
                    return <article key={message.id} className={`flex gap-2.5 ${own ? "flex-row-reverse" : ""}`} data-testid={`message-${message.id}`}>
                      <div className="w-8 h-8 shrink-0 rounded-full grid place-items-center text-[11px] font-bold" style={{ background: own ? "#E8CF7A" : "rgba(55,68,46,.13)", color: "#2A3622" }} aria-hidden="true">{(message.user_name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2) || "O").toUpperCase()}</div>
                      <div className={`min-w-0 max-w-[82%] ${own ? "text-right" : ""}`}>
                        <div className={`flex items-center gap-2 mb-1 ${own ? "justify-end" : ""}`}><span className="text-[12px] font-semibold" data-testid={`text-message-author-${message.id}`}>{own ? "You" : message.user_name}</span><time className="text-[10px] text-muted-ink" dateTime={message.created_at} data-testid={`text-message-time-${message.id}`}>{timeLabel(message.created_at, event.timezone)}</time></div>
                        <div className={`rounded-[16px] px-3.5 py-2.5 text-[14px] whitespace-pre-wrap break-words text-left ${own ? "rounded-tr-sm" : "rounded-tl-sm"}`} style={{ background: message.deleted_at ? "rgba(35,41,30,.06)" : own ? "#37442E" : "rgba(255,255,255,.8)", color: message.deleted_at ? "var(--muted-ink)" : own ? "#FEFCF0" : "var(--ink)", border: "1px solid rgba(55,68,46,.08)" }} data-testid={`text-message-body-${message.id}`}>{message.deleted_at ? "Message deleted" : message.body}</div>
                        {own && !message.deleted_at && <button type="button" className="text-[11px] text-muted-ink hover:text-[#9A3A2A] mt-1 underline underline-offset-2" onClick={() => removeMessage(message)} disabled={deleteMessage.isPending} data-testid={`button-delete-message-${message.id}`}>Delete</button>}
                      </div>
                    </article>;
                  })}
            {messagesQuery.isError && feed.length > 0 && <div className="flex items-center justify-between gap-3 text-[12px] text-muted-ink" role="status" data-testid="status-refresh-messages-error"><span>Could not refresh. Showing saved messages.</span><button type="button" className="underline" onClick={() => void messagesQuery.refetch()} data-testid="button-retry-message-refresh">Retry</button></div>}
          </div>
          <Form {...messageForm}>
            <form onSubmit={submitMessage} className="p-4 sm:p-5 border-t" style={{ borderColor: "var(--line)", background: "rgba(255,255,255,.32)" }} data-testid="form-send-message">
              <FormField control={messageForm.control} name="body" render={({ field }) => <FormItem className="w-full"><FormLabel className="field-label">Message the team</FormLabel><div className="flex items-end gap-2"><FormControl><textarea id="chat-message" {...field} className="field min-h-[48px] max-h-36" rows={2} maxLength={2000} placeholder="A useful update, in plain text…" data-testid="input-chat-message" /></FormControl><button type="submit" className="btn btn-primary !px-4 shrink-0" disabled={!messageText.trim() || sendMessage.isPending} aria-label="Send message" data-testid="button-send-message"><Icon name="arrow" size={17} />{sendMessage.isPending ? "Sending" : "Send"}</button></div><div className="flex items-center justify-between mt-2"><FormDescription>Plain text · up to 2,000 characters</FormDescription><span className="font-mono-ui text-[11px] text-muted-ink" data-testid="text-chat-character-count">{messageText.length}/2000</span></div></FormItem>} />
              {messageError && <p className="field-error" role="alert" data-testid="status-send-message-error">{messageError}</p>}
            </form>
          </Form>
        </section>

        <aside className="space-y-5">
          <section className="ai-glass" data-testid="panel-announcement-composer">
            <div className="flex items-center gap-2 mono-label mb-2"><Icon name="megaphone" size={15} />Volunteer announcement</div>
            <h2 className="font-display text-[23px] leading-tight">One clear update, out to everyone.</h2>
            <p className="text-[13px] mt-2 mb-4">This appears on each volunteer’s private page. A new post replaces the current one; volunteers never see this team chat.</p>
            {announcementQuery.isLoading ? <div className="space-y-2 mb-4" data-testid="status-loading-announcement"><Skel className="h-4 w-28" /><Skel className="h-20" /></div>
              : announcementQuery.isError ? <div className="rounded-xl p-3 mb-4 border border-[#9A3A2A]/25" role="alert" data-testid="status-error-announcement"><p className="text-[13px]">Current announcement could not load.</p><button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => void announcementQuery.refetch()} data-testid="button-retry-announcement">Try again</button></div>
                : announcementQuery.data ? <div className="rounded-xl p-3.5 mb-4" style={{ background: "rgba(255,255,255,.48)" }} data-testid="panel-current-announcement"><div className="flex items-center justify-between gap-2 mb-2"><span className="mono-label">Currently posted</span><time className="text-[11px] text-muted-ink" dateTime={announcementQuery.data.created_at} data-testid="text-current-announcement-date">{timeLabel(announcementQuery.data.created_at, event.timezone)}</time></div><p className="text-[14px] whitespace-pre-wrap" data-testid="text-current-announcement">{announcementQuery.data.body}</p></div>
                  : <div className="rounded-xl p-3.5 mb-4 border border-dashed border-[#37442E]/25 text-[13px] text-muted-ink" data-testid="status-empty-announcement">No announcement is posted yet.</div>}
            <Form {...announcementForm}>
              <form onSubmit={createAnnouncement} data-testid="form-announcement">
              <FormField control={announcementForm.control} name="body" render={({ field }) => <FormItem className="w-full"><FormLabel className="field-label">Announcement text</FormLabel><FormControl><textarea id="announcement-body" {...field} onChange={(e) => { field.onChange(e); if (draft) setDraft(null); }} className="field bg-white/80" rows={5} maxLength={500} placeholder="Tell volunteers what changed, where to go, or what to bring." data-testid="input-announcement-body" /></FormControl><div className="flex justify-end mt-1"><span className="font-mono-ui text-[11px] text-muted-ink" data-testid="text-announcement-character-count">{announcementText.length}/500</span></div></FormItem>} />
              {draft && <p className="text-[12px] mt-2" data-testid="text-draft-notice">{draft.notice} · {draft.ai_remaining} drafts remaining</p>}
              {draftError && <p className="field-error" role="alert" data-testid="status-draft-error">{draftError}</p>}
              {announcementError && <p className="field-error" role="alert" data-testid="status-announcement-error">{announcementError}</p>}
              <div className="flex flex-wrap gap-2 mt-3">
                <button type="submit" className="btn btn-primary flex-1" disabled={!announcementText.trim() || postAnnouncement.isPending} data-testid="button-post-announcement">{postAnnouncement.isPending ? "Posting" : "Post"}</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copyAnnouncement()} data-testid="button-copy-announcement"><Icon name="copy" size={14} />Copy text</button>
              </div>
              <button type="button" className="btn btn-ghost btn-sm w-full mt-2" onClick={makeDraft} disabled={draftAnnouncement.isPending} data-testid="button-draft-announcement"><Icon name="spark" size={14} />{draftAnnouncement.isPending ? "Drafting" : "Draft one"}</button>
              <p className="text-[11px] text-muted-ink mt-1 text-center" data-testid="text-draft-is-not-posted">A draft is never posted until you choose Post.</p>
              </form>
            </Form>
          </section>
          <section className="glass !p-4" data-testid="panel-chat-guidance"><div className="mono-label mb-2">A good event-day channel</div><p className="text-[13px] text-muted-ink">Keep coordination here for organizers. Post anything volunteers need to know as a public announcement instead.</p></section>
        </aside>
      </div>
    </Shell>
  );
}
