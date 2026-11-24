import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetEventQueryKey, getGetSessionQueryKey, useAskHelper, useCreateRole, useCreateTask, useUpdateTask,
  type EventBundle, type HelperAction,
} from "@workspace/api-client-react";
import { HELPER_SCREEN_INFO, type HelperScreen } from "@/lib/helper-screens";
import { Icon, Star } from "@/components/brand";
import { MessageDialog } from "@/components/message-dialog";
import { useToast } from "@/hooks/use-toast";
import { useEncore } from "@/lib/session";
import { errorMessage } from "@/lib/encore";

type ActState = { applied?: boolean; title?: string; name?: string; slots?: number; instruction?: string };

export function HelperPanel({
  b,
  screen,
  suggestedQuestion,
  variant = "docked",
}: {
  b: EventBundle;
  screen: HelperScreen;
  suggestedQuestion?: string;
  variant?: "docked" | "drawer";
}) {
  const id = b.event.id;
  const qc = useQueryClient();
  const { toast } = useToast();
  const { session } = useEncore();
  const ask = useAskHelper();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const createRole = useCreateRole();
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const [question, setQuestion] = useState(suggestedQuestion ?? "");
  const [result, setResult] = useState<Awaited<ReturnType<typeof ask.mutateAsync>> | null>(null);
  const [acts, setActs] = useState<ActState[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [requestError, setRequestError] = useState("");
  const key = getGetEventQueryKey(id);

  useEffect(() => {
    if (suggestedQuestion) {
      setQuestion(suggestedQuestion);
      requestAnimationFrame(() => questionRef.current?.focus());
    }
  }, [suggestedQuestion]);

  const askQuestion = (text = question) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setRequestError("");
    setResult(null);
    setActs([]);
    ask.mutate({ data: { event_id: id, screen, question: trimmed } }, {
      onSuccess: (response) => {
        setResult(response);
        setActs(response.actions.map((action) => ({
          title: action.payload.title,
          name: action.payload.name,
          slots: action.payload.slots_needed ?? 1,
          instruction: action.payload.instruction ?? "",
        })));
        qc.invalidateQueries({ queryKey: getGetSessionQueryKey() });
      },
      onError: (error) => {
        const text = errorMessage(error, "The helper could not answer. Try again.");
        setRequestError(text);
        toast({ title: "The helper could not answer", description: text, variant: "destructive" });
      },
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    askQuestion();
  };
  const mark = (index: number) => setActs((current) => current.map((item, i) => i === index ? { ...item, applied: true } : item));
  const apply = (action: HelperAction, index: number) => {
    const draft = acts[index];
    const done = (label: string) => {
      mark(index);
      qc.invalidateQueries({ queryKey: key });
      toast({ title: label });
    };
    const fail = (error: unknown) => toast({ title: "Could not apply", description: errorMessage(error), variant: "destructive" });
    if (action.type === "add_task") {
      if (!draft.title?.trim()) return;
      createTask.mutate({ id, data: { title: draft.title.trim(), status: "todo" } }, { onSuccess: () => done("Task added"), onError: fail });
    } else if (action.type === "assign_task" && action.payload.task_id) {
      updateTask.mutate({
        id, itemId: action.payload.task_id,
        data: { assignee_volunteer_id: action.payload.volunteer_id ?? null, assignee_user_id: null },
      }, { onSuccess: () => done("Assigned"), onError: fail });
    } else if (action.type === "add_role") {
      if (!draft.name?.trim()) return;
      createRole.mutate({
        id,
        data: { name: draft.name.trim(), slots_needed: Math.max(1, Math.min(100, draft.slots || 1)), instruction: draft.instruction ?? "" },
      }, { onSuccess: () => done("Role added"), onError: fail });
    } else if (action.type === "draft_message") {
      setMsg(action.payload.message ?? "");
      mark(index);
    }
  };
  const busy = createTask.isPending || updateTask.isPending || createRole.isPending;
  return (
    <section className={variant === "docked" ? "ai-glass relative" : "helper-drawer-card"} id="panel-helper" data-testid="panel-helper">
      {variant === "docked" && <Star size={12} className="absolute top-4 right-4" />}
      <div className="font-display text-[20px] leading-tight flex items-center gap-2">
        <Icon name="spark" size={18} /> Ask the helper
      </div>
      <p className="text-[13px] mt-1 mb-3">{variant === "docked" ? "It suggests. Nothing changes until you click." : "It suggests. Nothing changes until you choose an action."}</p>
      <form onSubmit={submit}>
        <label className="sr-only" htmlFor={`helper-question-${id}`}>Ask about {HELPER_SCREEN_INFO[screen].label}</label>
        <textarea
          ref={questionRef}
          autoFocus={variant === "drawer"}
          id={`helper-question-${id}`}
          className="field text-[14px]"
          rows={3}
          value={question}
          maxLength={2000}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={variant === "docked" ? "What am I forgetting for event day?" : `What would help with ${HELPER_SCREEN_INFO[screen].label.toLowerCase()}?`}
          style={{ background: "rgba(255,255,255,0.75)" }}
          data-testid="input-helper-question"
        />
        <div className="flex items-center justify-between gap-3 mt-2">
          {variant === "drawer" && <span className="text-[11px] text-muted-ink">{question.length}/2000</span>}
          <button type="submit" className={`btn btn-primary btn-sm ${variant === "docked" ? "mt-2.5 w-full" : ""}`} disabled={ask.isPending || !question.trim()} data-testid="button-ask">
            {ask.isPending ? (variant === "docked" ? "Thinking" : "Thinking…") : "Ask"}
          </button>
        </div>
      </form>
      <div className="text-[12px] mt-2 text-center font-mono-ui uppercase tracking-[0.1em]" style={{ color: "#5A4A0A" }} data-testid="text-helper-remaining">
        {(result?.ai_remaining ?? session?.ai_remaining) ?? 0} uses left this month
      </div>
      {ask.isPending && <div className="mt-3 space-y-2" role="status" aria-live="polite" data-testid="status-helper-loading"><div className="skel h-14" /><div className="skel h-10" /></div>}
      {requestError && variant === "drawer" && !ask.isPending && (
        <div className="mt-3 rounded-xl p-3 text-[14px]" style={{ background: "rgba(166,64,47,0.08)", color: "#8A3426" }} role="alert" data-testid="status-helper-error">
          <p>{requestError}</p>
          <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => askQuestion()} data-testid="button-helper-retry">Try again</button>
        </div>
      )}
      {variant === "drawer" && !result && !ask.isPending && !requestError && (
        <p className="text-[13px] text-muted-ink mt-3" data-testid="status-helper-empty">Choose a prompt or ask your own question. Your event stays unchanged until you apply an action.</p>
      )}
      {result && !ask.isPending && (
        <div className="mt-4 space-y-2.5" data-testid="panel-helper-response">
          {result.notice && <p className="text-[12px] italic" data-testid="text-helper-notice">{result.notice}</p>}
          <div className="rounded-xl p-3 text-[14px] leading-relaxed whitespace-pre-wrap" style={{ background: "rgba(255,255,255,0.7)" }} data-testid="text-helper-answer">{result.answer}</div>
          {result.actions.map((action, index) => {
            const draft = acts[index] ?? {};
            return (
              <div key={`${action.type}-${index}`} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.7)", border: "1px solid rgba(201,168,76,0.6)" }} data-testid={`card-helper-action-${index}`}>
                <div className="text-[12px] font-mono-ui uppercase tracking-[0.1em] mb-1.5" style={{ color: "#5A4A0A" }}>{action.type.replace("_", " ")}</div>
                {action.type === "add_task" && !draft.applied && <input className="field field-compact mb-2" value={draft.title ?? ""} onChange={(event) => setActs((items) => items.map((item, i) => i === index ? { ...item, title: event.target.value } : item))} aria-label={variant === "docked" ? "Task title" : "Suggested task title"} />}
                {action.type === "add_role" && !draft.applied && (
                  <div className="space-y-1.5 mb-2">
                    <input className="field field-compact" value={draft.name ?? ""} onChange={(event) => setActs((items) => items.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} aria-label={variant === "docked" ? "Role name" : "Suggested role name"} />
                    <div className="flex gap-1.5">
                      <input type="number" min={1} max={100} className="field field-compact w-20" value={draft.slots ?? 1} onChange={(event) => setActs((items) => items.map((item, i) => i === index ? { ...item, slots: Number(event.target.value) } : item))} aria-label={variant === "docked" ? "Slots" : "Suggested role spots"} />
                      <input className="field field-compact flex-1" value={draft.instruction ?? ""} placeholder="Instruction" onChange={(event) => setActs((items) => items.map((item, i) => i === index ? { ...item, instruction: event.target.value } : item))} aria-label={variant === "docked" ? "Instruction" : "Suggested role instruction"} />
                    </div>
                  </div>
                )}
                {draft.applied ? (
                  <span className="chip chip-done"><Icon name="check" size={12} /> {variant === "docked" ? "Applied" : "Draft ready"}</span>
                ) : (
                  <button type="button" className="btn btn-sm w-full" style={{ background: "#37442E", color: "#fff" }} disabled={busy} onClick={() => apply(action, index)} data-testid={`button-apply-action-${index}`}>
                    {variant === "docked" ? action.label : action.type === "draft_message" ? "Review message draft" : `Apply: ${action.label}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <MessageDialog open={msg !== null} onOpenChange={(open) => !open && setMsg(null)} title="Message draft" initial={msg ?? ""} subject={b.event.name} />
    </section>
  );
}
