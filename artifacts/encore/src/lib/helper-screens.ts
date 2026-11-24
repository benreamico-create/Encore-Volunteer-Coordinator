import type { HelperInput } from "@workspace/api-client-react";

export type HelperScreen = HelperInput["screen"];

export const HELPER_SCREEN_INFO: Record<HelperScreen, { label: string; prompts: [string, string, string] }> = {
  dashboard: {
    label: "Dashboard",
    prompts: ["What should I focus on next?", "Are any important tasks still unassigned?", "What should carry forward?"],
  },
  new_event: {
    label: "New event",
    prompts: ["What should I add to this event plan?", "What details should I confirm before drafting?", "Which team roles might I need?"],
  },
  plan: {
    label: "Plan",
    prompts: ["What important work might be missing?", "Are the volunteer roles covered?", "What should happen first?"],
  },
  tasks: {
    label: "Tasks",
    prompts: ["Which open task should I handle first?", "What work is still unassigned?", "What should be ready before event day?"],
  },
  volunteers: {
    label: "Volunteers",
    prompts: ["Which roles still need people?", "What should volunteers know before arrival?", "What should I include in a team message?"],
  },
  blueprint: {
    label: "Blueprint",
    prompts: ["Which volunteer posts need attention?", "What should I check on a venue walk-through?", "Are any map items missing a role?"],
  },
  chat: {
    label: "Chat",
    prompts: ["What follow-up task would help the team?", "Draft a short team check-in.", "How can I make the next steps clear?"],
  },
  wrapup: {
    label: "Wrap-up",
    prompts: ["Help me reflect on what worked.", "What should I consider carrying forward?", "Turn my lesson into a next step."],
  },
  next: {
    label: "Next event",
    prompts: ["What should I check before creating this event?", "Which items should I consider carrying forward?", "What should the team prepare first?"],
  },
};
