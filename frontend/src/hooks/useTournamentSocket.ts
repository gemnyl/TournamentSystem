import { useEffect, useRef, useCallback } from "react";
import type { Registration } from "@/types/api";

interface UseTournamentSocketOptions {
  onConnect?:    () => void;
  onDisconnect?: () => void;
}

/**
 * Хук підписки на WebSocket-оновлення турніру (реєстрації тощо).
 *
 * Підключається до ws://localhost:8000/ws/tournament/{tournamentId}/
 * через Vite proxy.
 * При розриві повторно підключається з exponential backoff.
 *
 * @param tournamentId          — id турніру
 * @param onRegistrationUpdate  — callback при зміні статусу реєстрації
 * @param options               — опційні колбеки connect/disconnect
 */
export function useTournamentSocket(
  tournamentId: number,
  onRegistrationUpdate: (registration: Registration) => void,
  options?: UseTournamentSocketOptions,
) {
  const wsRef                = useRef<WebSocket | null>(null);
  const retryRef             = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay           = useRef(1000);
  const isMounted            = useRef(true);
  const onRegUpdateRef       = useRef(onRegistrationUpdate);
  const optionsRef           = useRef(options);
  const pingIntervalRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  // Тримаємо актуальні посилання без re-subscribe
  useEffect(() => { onRegUpdateRef.current = onRegistrationUpdate; }, [onRegistrationUpdate]);
  useEffect(() => { optionsRef.current = options; },   [options]);

  const connect = useCallback(() => {
    if (!isMounted.current) return;
    if (!tournamentId) return;

    const url = `/ws/tournament/${tournamentId}/`;
    const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}${url}`;

    if (wsRef.current) {
      const oldWs = wsRef.current;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onerror = null;
      oldWs.onclose = null;
      try {
        oldWs.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    let pongTimeout: ReturnType<typeof setTimeout> | null = null;

    const sendPing = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));

        if (pongTimeout) clearTimeout(pongTimeout);
        pongTimeout = setTimeout(() => {
          console.warn("WebSocket tournament ping timeout, closing connection...");
          ws.close();
        }, 5000);
      }
    };

    ws.onopen = () => {
      retryDelay.current = 1000;
      optionsRef.current?.onConnect?.();

      sendPing();
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = setInterval(sendPing, 15000);
    };

    ws.onmessage = (event) => {
      if (pongTimeout) {
        clearTimeout(pongTimeout);
        pongTimeout = null;
      }
      try {
        const msg = JSON.parse(event.data as string) as { type: string; registration?: Registration };
        if (msg.type === "pong") {
          return;
        }
        if (msg.type === "registration.update" && msg.registration) {
          onRegUpdateRef.current(msg.registration);
        }
      } catch {
        // ignore invalid messages
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
      optionsRef.current?.onDisconnect?.();
      if (!isMounted.current) return;

      const delay = Math.min(retryDelay.current, 30_000);
      retryDelay.current = Math.min(retryDelay.current * 2, 30_000);

      retryRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [tournamentId]);

  useEffect(() => {
    isMounted.current = true;
    connect();

    return () => {
      isMounted.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (wsRef.current) {
        const oldWs = wsRef.current;
        oldWs.onopen = null;
        oldWs.onmessage = null;
        oldWs.onerror = null;
        oldWs.onclose = null;
        try {
          oldWs.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
    };
  }, [connect]);
}
