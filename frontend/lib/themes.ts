/**
 * Theme registry — the single source of truth for the configurable palettes.
 *
 * Each id maps to a `[data-theme="..."]` block in app/globals.css. Adding a
 * palette = add an entry here + the matching CSS block; the switcher and every
 * component pick it up automatically (they only read semantic CSS vars).
 */

export type ThemeId = "dark" | "bright";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  description: string;
  scheme: "dark" | "light";
  /** Representative hexes for the switcher swatch only (not used for styling). */
  swatch: { primary: string; accent: string; background: string };
}

export const THEMES: ThemeMeta[] = [
  {
    id: "dark",
    label: "Dark Mode",
    description: "Dark, premium — amber glow on near-black.",
    scheme: "dark",
    swatch: { primary: "#f59e0b", accent: "#f97316", background: "#0c0a09" },
  },
  {
    id: "bright",
    label: "Olive & Tomato",
    description: "Extreme dark olive backdrop, warm sand app, and vibrant red/yellow accents.",
    scheme: "light",
    swatch: { primary: "#d92d20", accent: "#eab308", background: "#151a14" },
  }
];

export const DEFAULT_THEME: ThemeId = "dark";
export const THEME_STORAGE_KEY = "slicematic-theme";

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return !!value && THEMES.some((t) => t.id === value);
}
