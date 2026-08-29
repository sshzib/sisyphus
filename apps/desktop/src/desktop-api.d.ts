import type { SisyphusDesktopApi } from "./preload.js";

declare global {
  interface Window {
    sisyphusDesktop: SisyphusDesktopApi;
  }
}

export {};
