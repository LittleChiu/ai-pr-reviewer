"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "aipr.recent.urls";
const MAX = 5;

let cache: string[] = [];
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function readStorage(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function ensureHydrated() {
  if (hydrated) return;
  hydrated = true;
  cache = readStorage();
}

function subscribe(cb: () => void): () => void {
  ensureHydrated();
  listeners.add(cb);
  // Sync across tabs.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cache = readStorage();
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

const SERVER_SNAPSHOT: string[] = [];

function getSnapshot(): string[] {
  ensureHydrated();
  return cache;
}

function getServerSnapshot(): string[] {
  return SERVER_SNAPSHOT;
}

export function useRecentUrls(): {
  recent: string[];
  push: (url: string) => void;
} {
  const recent = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const push = useCallback((url: string) => {
    ensureHydrated();
    const next = [url, ...cache.filter((u) => u !== url)].slice(0, MAX);
    cache = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // quota / private mode, fall back silently
    }
    emit();
  }, []);

  return { recent, push };
}
