import { useCallback, useEffect, useRef } from "react";
import type { Match, TatamiSnapshot, TimerStatus } from "@/types/api";

export interface TimerStatePayload {
  status: TimerStatus;
  started_at_ms: number | null;
  elapsed_ms: number;
  duration_ms: number;
}

interface UseTatamiSocketOptions {
  onSnapshot: (data: TatamiSnapshot) => void;
  onMatchEvent: (event: { sequence: number; event_type: string; payload: unknown }, match: Match) => void;
  onTimerState: (state: TimerStatePayload, server_ts_ms: number) => void;
  onTatamiState: (data: { tatami: TatamiSnapshot["tatami"]; current_match: Match | null }) => void;
}

export function useTatamiSocket(
  tid: string | number,
  n: string | number,
  options: UseTatamiSocketOptions,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(1000);
  const isMounted = useRef(true);
  const optsRef = useRef(options);

  useEffect(() => { optsRef.current = options; }, [options]);

  // Clock offset: server_ts_ms - Date.now(), updated on every timer.state
  const clockOffsetRef = useRef(0);

  const connect = useCallback(() => {
    if (!isMounted.current) return;

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/ws/tournament/${tid}/tatami/${n}/`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      retryDelay.current = 1000;
    };

    ws.onmessage = (e) => {
      let msg: { type: string; [k: string]: unknown };
      try {
        msg = JSON.parse(e.data as string);
      } catch {
        return;
      }

      switch (msg.type) {
        case "tatami.snapshot":
          optsRef.current.onSnapshot(msg.data as TatamiSnapshot);
          break;

        case "match.event":
          optsRef.current.onMatchEvent(
            msg.event as { sequence: number; event_type: string; payload: unknown },
            msg.match as Match,
          );
          break;

        case "timer.state": {
          const serverTs = msg.server_ts_ms as number;
          clockOffsetRef.current = serverTs - Date.now();
          optsRef.current.onTimerState(msg.state as TimerStatePayload, serverTs);
          break;
        }

        case "tatami.state":
          optsRef.current.onTatamiState(
            msg as unknown as { tatami: TatamiSnapshot["tatami"]; current_match: Match | null },
          );
          break;
      }
    };

    ws.onclose = () => {
      if (!isMounted.current) return;
      const delay = Math.min(retryDelay.current, 30_000);
      retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
      retryRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => { ws.close(); };
  }, [tid, n]);

  useEffect(() => {
    isMounted.current = true;
    connect();
    return () => {
      isMounted.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return clockOffsetRef;
}
