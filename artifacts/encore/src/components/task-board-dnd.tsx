import { useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";
import type { TaskStatus } from "@workspace/api-client-react";

export function TaskColumn({ status, label, active, children }: {
  status: TaskStatus; label: string; active: boolean; children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column-${status}`, data: { status } });
  return (
    <section ref={setNodeRef} className={`${active ? "flex" : "hidden"} min-[900px]:flex min-h-[320px] flex-col gap-3 rounded-[18px] p-2 -m-2 transition-colors ${isOver ? "bg-[rgba(55,68,46,0.09)] ring-2 ring-[#C8D98F]" : ""}`}
      aria-label={label} data-testid={`column-${status}`}>
      {children}
    </section>
  );
}

export function TaskColumnTab({ status, label, count, active, onSelect }: {
  status: TaskStatus; label: string; count: number; active: boolean; onSelect: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `tab-${status}`, data: { status } });
  return (
    <button ref={setNodeRef} type="button" role="tab" aria-selected={active} onClick={onSelect}
      className={`flex-1 h-11 rounded-[9px] text-[14px] font-semibold transition-all ${isOver ? "ring-2 ring-[#C8D98F]" : ""}`}
      style={active ? { background: "#fff", color: "#23291E", boxShadow: "0 1px 4px rgba(55,68,46,0.12)" } : { color: "#586050" }}
      data-testid={`tab-col-${status}`}>
      {label} <span className="text-muted-ink font-normal">{count}</span>
    </button>
  );
}
