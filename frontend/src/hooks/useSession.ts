import { useState } from "react";
import { desktopsApi } from "../services/api";
import type { ConnectResult } from "../types";

export function useSession() {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConnectResult | null>(null);

  const connect = async (desktopId: string) => {
    setConnecting(true);
    setError(null);
    setResult(null);
    try {
      const res = await desktopsApi.connect(desktopId);
      const data: ConnectResult = res.data;
      setResult(data);
      return data;
    } catch (err: any) {
      const msg = err.response?.data?.detail || "Connection failed";
      setError(msg);
      throw new Error(msg);
    } finally {
      setConnecting(false);
    }
  };

  return { connect, connecting, error, result };
}
