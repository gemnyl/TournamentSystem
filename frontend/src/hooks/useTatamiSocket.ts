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
  onTimerState: (state: TimerStatePayload, server_ts_ms: number, match_id?: number) => void;
  onTatamiState: (data: { tatami: TatamiSnapshot["tatami"]; current_match: Match | null }) => void;
  onClockOffsetUpdate?: (offset: number) => void;
}

export function useTatamiSocket(
  tid: string | number,
  n: string | number,
  options: UseTatamiSocketOptions,
) {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);
  const activeTabRef = useRef(true);
  const optsRef = useRef(options);

  useEffect(() => { optsRef.current = options; }, [options]);

  const lastPingSentAtRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const minRttRef = useRef<number>(Infinity);

  // Clock offset: server_ts_ms - Date.now(), updated on every timer.state
  const clockOffsetRef = useRef(0);

  // Share calibrated NTP offset across all browser tabs of the same tatami
  const syncChannelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const channelName = `tatami_time_${tid}_${n}`;
    const channel = new BroadcastChannel(channelName);
    syncChannelRef.current = channel;

    const handleRequestOffset = () => {
      if (minRttRef.current < Infinity && clockOffsetRef.current !== 0) {
        channel.postMessage({
          type: "offset",
          offset: clockOffsetRef.current,
          minRtt: minRttRef.current,
        });
      }
    };

    const handleIncomingOffset = (offset: number, incomingMinRtt: number) => {
      if (incomingMinRtt <= minRttRef.current || minRttRef.current === Infinity) {
        if (incomingMinRtt < minRttRef.current) {
          minRttRef.current = incomingMinRtt;
        }
        if (clockOffsetRef.current !== offset) {
          clockOffsetRef.current = offset;
          if (optsRef.current.onClockOffsetUpdate) {
            optsRef.current.onClockOffsetUpdate(offset);
          }
        }
      }
    };

    channel.onmessage = (e) => {
      const msg = e.data as { type: string; offset?: number; minRtt?: number };
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "request_offset") {
        handleRequestOffset();
      } else if (msg.type === "offset" && typeof msg.offset === "number") {
        handleIncomingOffset(msg.offset, msg.minRtt ?? Infinity);
      }
    };

    // Request the calibrated offset from other tabs immediately on mount
    channel.postMessage({ type: "request_offset" });

    return () => {
      channel.close();
    };
  }, [tid, n]);

  const connect = useCallback(() => {
    if (!activeTabRef.current) return;

    const proto = globalThis.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${globalThis.location.host}/ws/tournament/${tid}/tatami/${n}/`;
    const ws = new WebSocket(url);
    socketRef.current = ws;

    let pongTimeout: ReturnType<typeof setTimeout> | null = null;

    const sendPing = () => {
      if (ws.readyState === WebSocket.OPEN) {
        lastPingSentAtRef.current = Date.now();
        ws.send(JSON.stringify({ type: "ping" }));

        if (pongTimeout) clearTimeout(pongTimeout);
        pongTimeout = setTimeout(() => {
          console.warn("WebSocket ping timeout, closing connection...");
          ws.close();
        }, 5000);
      }
    };

    const handleSnapshot = (payload: { server_ts_ms?: unknown; data?: unknown }) => {
      const serverTs = payload.server_ts_ms as number;
      if (serverTs && clockOffsetRef.current === 0) {
        clockOffsetRef.current = serverTs - Date.now();
        if (optsRef.current.onClockOffsetUpdate) {
          optsRef.current.onClockOffsetUpdate(clockOffsetRef.current);
        }
      }
      optsRef.current.onSnapshot(payload.data as TatamiSnapshot);
    };

    const handleMatchEvent = (payload: { event?: unknown; match?: unknown }) => {
      optsRef.current.onMatchEvent(
        payload.event as { sequence: number; event_type: string; payload: unknown },
        payload.match as Match,
      );
    };

    const handlePong = (payload: { server_ts_ms?: unknown }) => {
      if (lastPingSentAtRef.current !== null) {
        const now = Date.now();
        const rtt = now - lastPingSentAtRef.current;

        if (rtt > 150) {
          return;
        }

        const serverTs = payload.server_ts_ms as number;
        const correctedOffset = serverTs - (lastPingSentAtRef.current + rtt / 2);

        if (rtt < minRttRef.current) {
          minRttRef.current = rtt;
          clockOffsetRef.current = correctedOffset;
        } else {
          clockOffsetRef.current = Math.round(clockOffsetRef.current * 0.9 + correctedOffset * 0.1);
        }

        syncChannelRef.current?.postMessage({
          type: "offset",
          offset: clockOffsetRef.current,
          minRtt: minRttRef.current,
        });

        if (optsRef.current.onClockOffsetUpdate) {
          optsRef.current.onClockOffsetUpdate(clockOffsetRef.current);
        }
      }
    };

    const handleTimerState = (payload: { match_id?: unknown; server_ts_ms?: unknown; state?: unknown }) => {
      const matchId = payload.match_id as number | undefined;
      const serverTs = payload.server_ts_ms as number;
      if (clockOffsetRef.current === 0) {
        clockOffsetRef.current = serverTs - Date.now();
        if (optsRef.current.onClockOffsetUpdate) {
          optsRef.current.onClockOffsetUpdate(clockOffsetRef.current);
        }
      }

      const correctedServerTs = Date.now() + clockOffsetRef.current;
      optsRef.current.onTimerState(payload.state as TimerStatePayload, correctedServerTs, matchId);
    };

    const handleTatamiState = (payload: { server_ts_ms?: unknown }) => {
      const serverTs = payload.server_ts_ms as number;
      if (serverTs && clockOffsetRef.current === 0) {
        clockOffsetRef.current = serverTs - Date.now();
        if (optsRef.current.onClockOffsetUpdate) {
          optsRef.current.onClockOffsetUpdate(clockOffsetRef.current);
        }
      }
      optsRef.current.onTatamiState(
        payload as unknown as { tatami: TatamiSnapshot["tatami"]; current_match: Match | null },
      );
    };

    ws.onopen = () => {
      reconnectDelay.current = 1000;
      sendPing();

      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = setInterval(sendPing, 15000);
    };

    ws.onmessage = (e) => {
      if (pongTimeout) {
        clearTimeout(pongTimeout);
        pongTimeout = null;
      }
      let msg: { type: string; [k: string]: unknown };
      try {
        msg = JSON.parse(e.data as string);
      } catch {
        return;
      }

      if (msg.type === "tatami.snapshot") {
        handleSnapshot(msg as unknown as { server_ts_ms?: unknown; data?: unknown });
      } else if (msg.type === "match.event") {
        handleMatchEvent(msg as unknown as { event?: unknown; match?: unknown });
      } else if (msg.type === "pong") {
        handlePong(msg as unknown as { server_ts_ms?: unknown });
      } else if (msg.type === "timer.state") {
        handleTimerState(msg as unknown as { server_ts_ms?: unknown; state?: unknown });
      } else if (msg.type === "tatami.state") {
        handleTatamiState(msg as unknown as { server_ts_ms?: unknown });
      }
    };

    ws.onclose = () => {
      if (pongTimeout) {
        clearTimeout(pongTimeout);
        pongTimeout = null;
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (!activeTabRef.current) return;
      const delay = Math.min(reconnectDelay.current, 30_000);
      reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30_000);
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => { ws.close(); };
  }, [tid, n]);

  useEffect(() => {
    activeTabRef.current = true;
    connect();
    return () => {
      activeTabRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      socketRef.current?.close();
    };
  }, [connect]);

  return clockOffsetRef;
}
