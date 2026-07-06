import { useEffect, useRef } from "react";
import { WS_BASE } from "./api";

type RealtimeCallback = (event: { type: string; data: unknown }) => void;

export function useRealtime(
  eventTypes: string[],
  onEvent: RealtimeCallback,
  pollCallback?: () => void,
  pollIntervalMs = 8000
) {
  const onEventRef = useRef(onEvent);
  const pollCallbackRef = useRef(pollCallback);
  // Stabilize eventTypes — a new array literal on every render must not
  // cause the WebSocket to tear down and reconnect.
  const eventTypesRef = useRef(eventTypes);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    pollCallbackRef.current = pollCallback;
  }, [pollCallback]);

  useEffect(() => {
    eventTypesRef.current = eventTypes;
  }, [eventTypes]);

  // Run once on mount — no dependency on eventTypes or callbacks (handled via refs).
  useEffect(() => {
    let socket: WebSocket | null = null;
    let pollInterval: NodeJS.Timeout | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let isClosed = false;

    function connect() {
      if (isClosed) return;

      const wsUrl = `${WS_BASE}/api/realtime`;
      console.log(`[Realtime] Connecting to ${wsUrl}`);

      try {
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
          console.log("[Realtime] WebSocket connected.");
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        };

        socket.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data);
            if (parsed && parsed.type && eventTypesRef.current.includes(parsed.type)) {
              console.log("[Realtime] Event received:", parsed.type, parsed.data);
              onEventRef.current(parsed);
            }
          } catch (err) {
            console.error("[Realtime] Error parsing WebSocket message:", err);
          }
        };

        socket.onclose = () => {
          console.log("[Realtime] WebSocket closed.");
          if (!isClosed) {
            startPolling();
            reconnectTimeout = setTimeout(connect, 5000);
          }
        };

        socket.onerror = () => {
          // Transient connection error — socket will close and reconnect automatically.
          console.warn("[Realtime] WebSocket connection error. Will retry in 5s.");
        };
      } catch (err) {
        console.error("[Realtime] Failed to create WebSocket:", err);
        startPolling();
        reconnectTimeout = setTimeout(connect, 5000);
      }
    }

    function startPolling() {
      if (pollInterval) return;
      if (pollCallbackRef.current) {
        console.log("[Realtime] Starting fallback polling...");
        // Execute immediately on switch to polling
        pollCallbackRef.current();
        pollInterval = setInterval(() => {
          if (pollCallbackRef.current) {
            pollCallbackRef.current();
          }
        }, pollIntervalMs);
      }
    }

    connect();

    return () => {
      isClosed = true;
      if (socket) {
        socket.close();
      }
      if (pollInterval) {
        clearInterval(pollInterval);
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollIntervalMs]); // pollIntervalMs is the only primitive that actually affects setup
}
