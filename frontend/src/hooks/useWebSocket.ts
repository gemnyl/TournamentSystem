import { useEffect, useRef, useCallback } from "react";

interface UseWebSocketOptions {
  onConnect?:    () => void;
  onDisconnect?: () => void;
}

/**
 * A generic hook to handle WebSocket connection, message handling, and automatic reconnection.
 *
 * @param urlPath - The relative path for the WebSocket connection (e.g., '/ws/category/1/'), or null to disconnect/not connect.
 * @param onMessage - Callback triggered when a message is received.
 * @param options - Optional handlers for connect and disconnect events.
 */
export function useWebSocket(
  urlPath: string | null,
  onMessage: (msg: unknown) => void,
  options?: UseWebSocketOptions,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(1000);
  const isMounted = useRef(true);
  const onMessageRef = useRef(onMessage);
  const optionsRef = useRef(options);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep refs up-to-date to avoid re-subscribing on every render
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);
  useEffect(() => { optionsRef.current = options; }, [options]);

  const connect = useCallback(() => {
    if (!isMounted.current) return;
    if (!urlPath) return;

    // Build absolute URL from relative path
    const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}${urlPath}`;

    // Clean up previous connection if it exists
    if (wsRef.current) {
      const oldWs = wsRef.current;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onerror = null;
      oldWs.onclose = null;
      try {
        oldWs.close();
      } catch {
        // ignore close error
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
          console.warn("WebSocket ping timeout, closing connection...");
          ws.close();
        }, 5000);
      }
    };

    ws.onopen = () => {
      retryDelay.current = 1000; // Reset exponential backoff
      optionsRef.current?.onConnect?.();

      sendPing(); // Ping immediately on open
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = setInterval(sendPing, 15000);
    };

    ws.onmessage = (event) => {
      if (pongTimeout) {
        clearTimeout(pongTimeout);
        pongTimeout = null;
      }
      try {
        const msg = JSON.parse(event.data as string);
        if (msg && typeof msg === "object" && "type" in msg && msg.type === "pong") {
          return;
        }
        onMessageRef.current(msg);
      } catch {
        // ignore invalid JSON messages
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

      // Exponential backoff up to 30 seconds
      const delay = Math.min(retryDelay.current, 30_000);
      retryDelay.current = Math.min(retryDelay.current * 2, 30_000);

      retryRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close(); // let onclose handle reconnection
    };
  }, [urlPath]);

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
