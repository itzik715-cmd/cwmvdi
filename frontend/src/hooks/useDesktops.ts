import { useState, useEffect, useCallback } from "react";
import { desktopsApi } from "../services/api";
import type { Desktop } from "../types";

export function useDesktops() {
  const [desktops, setDesktops] = useState<Desktop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      setError(null);
      const res = await desktopsApi.list();
      setDesktops(res.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to load desktops");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    // Refresh every 30 seconds
    const interval = setInterval(fetch, 30_000);
    return () => clearInterval(interval);
  }, [fetch]);

  return { desktops, loading, error, refresh: fetch };
}
