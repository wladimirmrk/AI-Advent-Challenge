import { useSyncExternalStore } from 'react';
import { loadThemePreference, saveThemePreference, ThemePreference } from './agent/storage';

export type { ThemePreference };

export interface ThemeState {
  /** What the user picked: explicit light/dark or follow the OS. */
  preference: ThemePreference;
  /** What is actually applied to <html> right now. */
  resolvedTheme: 'light' | 'dark';
}

let preference: ThemePreference = loadThemePreference() ?? 'system';
let resolvedTheme: 'light' | 'dark' = 'dark';
// useSyncExternalStore compares snapshots by reference, so keep a stable
// object and only replace it when the state actually changes.
let state: ThemeState = { preference, resolvedTheme };

const listeners = new Set<() => void>();

const systemDarkQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

function notify(): void {
  listeners.forEach((listener) => listener());
}

function applyTheme(): void {
  resolvedTheme = preference === 'system' ? (systemDarkQuery?.matches ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = resolvedTheme;
  state = { preference, resolvedTheme };
}

function handleSystemChange(): void {
  if (preference !== 'system') return;
  applyTheme();
  notify();
}

/**
 * Apply the stored preference and start watching the OS color scheme.
 * Call once before the first React render.
 */
export function initTheme(): void {
  applyTheme();
  systemDarkQuery?.addEventListener('change', handleSystemChange);
}

export function getThemeState(): ThemeState {
  return state;
}

export function setThemePreference(next: ThemePreference): void {
  if (next === preference) return;
  preference = next;
  saveThemePreference(next);
  applyTheme();
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * React binding for the theme switcher UI.
 */
export function useThemePreference(): ThemeState & { setPreference: (next: ThemePreference) => void } {
  const state = useSyncExternalStore(subscribe, getThemeState, getThemeState);
  return { ...state, setPreference: setThemePreference };
}
