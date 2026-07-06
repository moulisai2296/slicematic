"use client";

import { Check, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useTheme } from "@/components/theme-provider";
import { THEMES } from "@/lib/themes";
import { cn } from "@/lib/utils";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Make sure hydration mismatch doesn't happen with the icon by rendering nothing or a default
  // Wait, theme is loaded on client. Actually useTheme initializes it with DEFAULT_THEME synchronously.
  
  return (
    <div className="fixed bottom-4 right-4 z-50" ref={ref}>
      {open && (
        <div
          role="menu"
          className="absolute bottom-14 right-0 w-56 animate-bubble-in rounded-xl border border-border bg-card p-1.5 shadow-xl"
        >
          {THEMES.map((t) => (
            <button
              key={t.id}
              role="menuitemradio"
              aria-checked={theme === t.id}
              onClick={() => {
                setTheme(t.id);
                setOpen(false);
              }}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-2",
                theme === t.id && "bg-surface-2"
              )}
            >
              <span className="flex-1">
                <span className="block text-sm font-medium text-foreground">
                  {t.label}
                </span>
              </span>
              {theme === t.id && (
                <Check className="size-4 shrink-0 text-primary" />
              )}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        aria-label="Toggle theme"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid size-12 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95"
      >
        {theme === "dark" ? <Moon className="size-5" /> : <Sun className="size-5" />}
      </button>
    </div>
  );
}
