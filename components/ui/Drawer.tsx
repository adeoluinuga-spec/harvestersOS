"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Right-hand slide-over panel — the drill-down surface of Phase 4.
 *
 * Permalink rule: content rendered here must also exist at a real URL.
 * The default close action is router.back(), so a drawer opened from a list
 * returns to the list, while the same URL opened directly renders the full
 * page — overlay UX without ever sacrificing deep-linkability.
 */
export function Drawer({
  open = true,
  onClose,
  title,
  subtitle,
  width = "max-w-2xl",
  children,
}: {
  open?: boolean;
  onClose?: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  width?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    if (onClose) onClose();
    else router.back();
  }, [onClose, router]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-ink/20 backdrop-blur-[2px] transition-opacity"
        onClick={close}
        aria-hidden
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "absolute inset-y-0 right-0 flex w-full flex-col bg-surface shadow-overlay outline-none",
          "animate-[drawer-in_180ms_ease-out]",
          width
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-paper-200 px-6 py-4">
          <div className="min-w-0">
            {title && (
              <h2 className="truncate font-display text-lg font-semibold tracking-display text-ink">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-0.5 truncate font-sans text-sm text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close panel"
            className="rounded-md p-1.5 text-ink-400 transition-colors hover:bg-paper-100 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
