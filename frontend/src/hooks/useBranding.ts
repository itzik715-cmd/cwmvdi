import { useState, useEffect } from "react";
import { brandingApi } from "../services/api";

export interface Branding {
  brand_name: string | null;
  logo_url: string | null;
  favicon_url: string | null;
}

const DEFAULT_BRANDING: Branding = {
  brand_name: null,
  logo_url: null,
  favicon_url: null,
};

let cached: Branding | null = null;
let listeners: Array<(b: Branding) => void> = [];

function notify(b: Branding) {
  cached = b;
  listeners.forEach((fn) => fn(b));
}

export function refreshBranding() {
  brandingApi.get().then((res) => notify(res.data)).catch(() => {});
}

export function useBranding(): Branding {
  const [branding, setBranding] = useState<Branding>(cached || DEFAULT_BRANDING);

  useEffect(() => {
    listeners.push(setBranding);
    if (!cached) {
      brandingApi
        .get()
        .then((res) => notify(res.data))
        .catch(() => {});
    }
    return () => {
      listeners = listeners.filter((fn) => fn !== setBranding);
    };
  }, []);

  return branding;
}
