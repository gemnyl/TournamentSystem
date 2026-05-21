import { useEffect, useRef, useState } from "react";
import type { TimerStatus } from "@/types/api";

export interface TimerState {
  status: TimerStatus;
  started_at_ms: number | null;
  elapsed_ms: number;
  duration_ms: number;
}

export function useTimer(initial: TimerState, serverTimeOffset: number) {
  const [state, setState] = useState<TimerState>(initial);
  const [remainingMs, setRemainingMs] = useState(
    initial.duration_ms - initial.elapsed_ms,
  );

  const stateRef = useRef(state);
  const offsetRef = useRef(serverTimeOffset);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { offsetRef.current = serverTimeOffset; }, [serverTimeOffset]);

  useEffect(() => {
    let raf: number;

    const tick = () => {
      const s = stateRef.current;
      if (s.status === "running" && s.started_at_ms !== null) {
        const now = Date.now() + offsetRef.current;
        const elapsed = s.elapsed_ms + (now - s.started_at_ms);
        setRemainingMs(Math.max(0, s.duration_ms - elapsed));
      } else {
        setRemainingMs(Math.max(0, s.duration_ms - s.elapsed_ms));
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return { state, setState, remainingMs };
}

export function formatTimer(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
