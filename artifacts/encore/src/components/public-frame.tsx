import type { ReactNode } from "react";
import { Orbs, Star, Wordmark } from "@/components/brand";

export function PublicFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-h-[100dvh]">
      <Orbs />
      <div className="relative max-w-[430px] mx-auto px-5 pt-6 pb-12">
        <header className="flex items-center justify-between mb-7 rise">
          <Wordmark size={24} />
          <span className="mono-label">{label}</span>
        </header>
        <Star size={14} className="absolute right-6 top-20" />
        {children}
      </div>
    </div>
  );
}

export function PublicMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="glass rise !p-7 text-center" data-testid="panel-public-message">
      <h1 className="font-display text-[28px] leading-tight">{title}</h1>
      <p className="text-muted-ink mt-3">{body}</p>
    </div>
  );
}
