import { useEffect, useState } from "react";
import { api, type SystemMode } from "./api";

let cached: Promise<SystemMode> | null = null;

/** The instance's mode, fetched once per page load. Null while loading. */
export function useSystemMode(): SystemMode | null {
  const [mode, setMode] = useState<SystemMode | null>(null);
  useEffect(() => {
    cached ??= api.getSystemMode().catch(() => {
      cached = null;
      return { cloud: false, signupOpen: false, emailVerification: false };
    });
    let live = true;
    cached.then((m) => live && setMode(m));
    return () => {
      live = false;
    };
  }, []);
  return mode;
}
