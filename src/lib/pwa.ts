/**
 * Veb versiya uchun: oflayn kesh (service worker) va «ilovani oʻrnatish».
 * Android (Capacitor) ichida bularning keragi yoʻq.
 */
import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPrompt | null = null;
const listeners = new Set<(available: boolean) => void>();

/** Ilova ishga tushganda bir marta. */
export function registerPwa(): void {
  if (Capacitor.isNativePlatform()) return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as InstallPrompt;
    listeners.forEach((l) => l(true));
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l(false));
  });

  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}

/** «Ilovani oʻrnatish» tugmasi uchun. */
export function useInstallPrompt(): { available: boolean; install: () => Promise<void> } {
  const [available, setAvailable] = useState(Boolean(deferred));

  useEffect(() => {
    const listener = (value: boolean) => setAvailable(value);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    setAvailable(false);
  };

  return { available, install };
}
