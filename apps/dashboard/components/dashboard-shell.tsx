"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { io, Socket } from "socket.io-client";

import {
  CameraSessionUpdatedEvent,
  CameraStreamErrorCode,
  CameraStreamAudioPollResponse,
  CameraStreamSessionRequest,
  CameraStreamSessionState,
  CameraViewerSignal,
  CallLogsPage,
  CreateDeviceCommandRequest,
  DeviceDetail,
  DeviceSummary,
  DeviceTelemetryState,
  NotificationsPage,
  PairingCodeView
} from "@safelens/contracts";
import { apiRequest, getApiBaseUrl } from "../lib/api";
import { useSession } from "./session-provider";

const FEATURE_MODULES = [
  "Screen Mirroring",
  "Location",
  "Notifications",
  "Call Logs"
];

type DeviceCameraStreamPanelState = {
  session: CameraStreamSessionState | null;
  loading: boolean;
  loaded: boolean;
  selectedFacing: "front" | "back";
  includeAudio: boolean;
  viewerId: string | null;
  transport: "webrtc" | "mjpeg" | null;
  mjpegUrl: string | null;
  audioFallbackActive: boolean;
  audioFallbackError: string | null;
  audioFallbackLastChunkAt: string | null;
};

type DeviceNotificationsState = {
  items: NotificationsPage["items"];
  nextCursor: string | null;
  appGroups: NotificationsPage["appGroups"];
  loading: boolean;
  loaded: boolean;
  draftQuery: string;
  appliedQuery: string;
  appLabel: string | null;
};

type DeviceCallLogsState = {
  items: CallLogsPage["items"];
  nextCursor: string | null;
  loading: boolean;
  loaded: boolean;
};

const EMPTY_NOTIFICATIONS_STATE: DeviceNotificationsState = {
  items: [],
  nextCursor: null,
  appGroups: [],
  loading: false,
  loaded: false,
  draftQuery: "",
  appliedQuery: "",
  appLabel: null
};

const EMPTY_CALL_LOGS_STATE: DeviceCallLogsState = {
  items: [],
  nextCursor: null,
  loading: false,
  loaded: false
};

const EMPTY_CAMERA_STREAM_STATE: DeviceCameraStreamPanelState = {
  session: null,
  loading: false,
  loaded: false,
  selectedFacing: "back",
  includeAudio: false,
  viewerId: null,
  transport: null,
  mjpegUrl: null,
  audioFallbackActive: false,
  audioFallbackError: null,
  audioFallbackLastChunkAt: null
};

const WEBRTC_NATIVE_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_WEBRTC_NATIVE === "true";

const CAMERA_ERROR_MESSAGES: Record<CameraStreamErrorCode, string> = {
  service_not_armed:
    "Camera service is not armed on the phone. Open SafeLens once to arm silent camera start.",
  fgs_start_blocked:
    "Android blocked camera activation in background. Open SafeLens and keep it active once before retrying.",
  camera_permission_missing:
    "Camera permission is missing on the phone. Grant camera permission in SafeLens app settings.",
  camera_open_failed:
    "Camera could not be opened on the phone. Check if another app is using the camera.",
  signaling_failed:
    "Camera signaling failed between device and dashboard. Check network and retry.",
  start_timeout:
    "Camera stream start timed out before signaling became ready."
};

function resolveCameraErrorMessage(
  sessionState: CameraStreamSessionState | null | undefined,
  fallback: string
) {
  if (!sessionState) {
    return fallback;
  }

  const serverError = sessionState.lastError?.trim();
  if (serverError) {
    return serverError;
  }

  if (sessionState.lastErrorCode) {
    return CAMERA_ERROR_MESSAGES[sessionState.lastErrorCode];
  }

  return fallback;
}

function getCameraRotationDegrees(cameraFacing: "front" | "back" | null | undefined) {
  return cameraFacing === "front" ? -90 : 90;
}

function resolvePreferredCameraTransport(
  includeAudio: boolean
): CameraStreamSessionRequest["preferredTransport"] {
  if (WEBRTC_NATIVE_ENABLED) {
    return "webrtc";
  }
  return "mjpeg";
}

export function DashboardShell() {
  const { session, clearSession } = useSession();
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [isPairingStationOpen, setIsPairingStationOpen] = useState(false);
  const [pairingCode, setPairingCode] = useState<PairingCodeView | null>(null);
  const [pairingApiBaseUrl, setPairingApiBaseUrl] = useState<string | null>(null);
  const [pairingQrUrl, setPairingQrUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [checkingDeviceId, setCheckingDeviceId] = useState<string | null>(null);
  const [removingDeviceId, setRemovingDeviceId] = useState<string | null>(null);
  const [commandingDeviceId, setCommandingDeviceId] = useState<string | null>(null);
  const [clearingNotificationsDeviceId, setClearingNotificationsDeviceId] = useState<
    string | null
  >(null);
  const [clearingCallLogsDeviceId, setClearingCallLogsDeviceId] = useState<string | null>(
    null
  );
  const [telemetryByDevice, setTelemetryByDevice] = useState<
    Record<string, DeviceTelemetryState>
  >({});
  const [notificationsByDevice, setNotificationsByDevice] = useState<
    Record<string, DeviceNotificationsState>
  >({});
  const [callLogsByDevice, setCallLogsByDevice] = useState<
    Record<string, DeviceCallLogsState>
  >({});
  const [cameraStreamsByDevice, setCameraStreamsByDevice] = useState<
    Record<string, DeviceCameraStreamPanelState>
  >({});
  const [error, setError] = useState<string | null>(null);
  const previousDeviceIdsRef = useRef<string[]>([]);
  const cameraSocketRef = useRef<Socket | null>(null);
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});
  const remoteStreamsRef = useRef<Record<string, MediaStream>>({});
  const videoElementsRef = useRef<Record<string, HTMLVideoElement | null>>({});
  const viewerToDeviceRef = useRef<Record<string, string>>({});
  const viewerTimeoutsRef = useRef<Record<string, number>>({});
  const pendingRemoteIceCandidatesRef = useRef<
    Record<string, RTCIceCandidateInit[]>
  >({});
  const audioContextsRef = useRef<Record<string, AudioContext>>({});
  const audioFallbackEnabledRef = useRef<Record<string, boolean>>({});
  const audioFallbackViewerRef = useRef<Record<string, string>>({});
  const audioFallbackSinceSeqRef = useRef<Record<string, number>>({});
  const audioFallbackNextPlayAtRef = useRef<Record<string, number>>({});
  const audioFallbackPollTimeoutsRef = useRef<Record<string, number>>({});

  async function loadDevices(accessToken: string) {
    const nextDevices = await apiRequest<DeviceSummary[]>("/devices", {
      accessToken
    });

    const previousDeviceIds = previousDeviceIdsRef.current;
    const nextDeviceIds = nextDevices.map((device) => device.id);
    const hasNewDevice = nextDeviceIds.some((deviceId) => !previousDeviceIds.includes(deviceId));

    if (isPairingStationOpen && hasNewDevice) {
      clearActivePairingCode();
    }

    previousDeviceIdsRef.current = nextDeviceIds;
    setDevices(nextDevices);
    setTelemetryByDevice((current) => pruneDeviceStateMap(current, nextDeviceIds));
    setNotificationsByDevice((current) => pruneDeviceStateMap(current, nextDeviceIds));
    setCallLogsByDevice((current) => pruneDeviceStateMap(current, nextDeviceIds));
    setCameraStreamsByDevice((current) => pruneDeviceStateMap(current, nextDeviceIds));
  }

  function clearActivePairingCode() {
    setIsPairingStationOpen(false);
    setPairingCode(null);
    setPairingApiBaseUrl(null);
    setPairingQrUrl(null);
  }

  function pruneDeviceStateMap<T>(
    current: Record<string, T>,
    nextDeviceIds: string[]
  ) {
    return Object.fromEntries(
      Object.entries(current).filter(([deviceId]) => nextDeviceIds.includes(deviceId))
    ) as Record<string, T>;
  }

  async function refreshPairingCodeStatus(accessToken: string) {
    if (!pairingCode) {
      return;
    }

    try {
      const latestPairingCode = await apiRequest<PairingCodeView>(
        `/pairing-codes/${pairingCode.code}`,
        {
          accessToken
        }
      );

      if (latestPairingCode.claimedAt) {
        clearActivePairingCode();
        return;
      }

      setPairingCode(latestPairingCode);
    } catch (pairingError) {
      if (
        pairingError instanceof Error &&
        /not found|expired|404/i.test(pairingError.message)
      ) {
        clearActivePairingCode();
      }
    }
  }

  if (!session) {
    return null;
  }

  const accessToken = session.accessToken;
  const qrPayload = useMemo(() => {
    if (!pairingCode || !pairingApiBaseUrl) {
      return null;
    }

    return JSON.stringify({
      type: "safelens-pairing",
      version: 1,
      code: pairingCode.code,
      apiBaseUrl: pairingApiBaseUrl,
      expiresAt: pairingCode.expiresAt
    });
  }, [pairingApiBaseUrl, pairingCode]);

  useEffect(() => {
    let active = true;

    if (!qrPayload) {
      setPairingQrUrl(null);
      return;
    }

    QRCode.toDataURL(qrPayload, {
      margin: 1,
      width: 280,
      color: {
        dark: "#1d2430",
        light: "#fffdf8"
      }
    })
      .then((dataUrl) => {
        if (active) {
          setPairingQrUrl(dataUrl);
        }
      })
      .catch(() => {
        if (active) {
          setPairingQrUrl(null);
        }
      });

    return () => {
      active = false;
    };
  }, [qrPayload]);

  async function createPairingCode() {
    setError(null);

    try {
      const [code, resolvedApiBaseUrl] = await Promise.all([
        apiRequest<PairingCodeView>("/pairing-codes", {
          method: "POST",
          accessToken
        }),
        resolvePairingApiBaseUrl()
      ]);
      setIsPairingStationOpen(true);
      setPairingCode(code);
      setPairingApiBaseUrl(resolvedApiBaseUrl);
      setPairingQrUrl(null);
    } catch (creationError) {
      setError(
        creationError instanceof Error
          ? creationError.message
          : "Could not generate a pairing code."
      );
    }
  }

  async function refreshRegistryNow() {
    setError(null);
    setLoading(true);

    try {
      await Promise.all([
        loadDevices(accessToken),
        refreshPairingCodeStatus(accessToken)
      ]);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Could not refresh the device registry."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function refreshRegistry() {
      try {
        await Promise.all([
          loadDevices(accessToken),
          refreshPairingCodeStatus(accessToken)
        ]);
        if (!cancelled) {
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          if (
            loadError instanceof Error &&
            /invalid|expired|unauthorized|401/i.test(loadError.message)
          ) {
            clearSession().catch(() => {
              // Clear the local session even if logout fails.
            });
            return;
          }
          setError(
            loadError instanceof Error ? loadError.message : "Could not load devices."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    refreshRegistry();
    const intervalId = window.setInterval(refreshRegistry, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [accessToken, clearSession, pairingCode?.code]);

  useEffect(() => {
    const deviceIds = Object.keys(telemetryByDevice);
    if (!deviceIds.length) {
      return;
    }

    const intervalId = window.setInterval(() => {
      deviceIds.forEach((deviceId) => {
        loadTelemetry(deviceId).catch(() => {
          // Surface through normal loadTelemetry error handling.
        });
      });
    }, 10_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [telemetryByDevice]);

  useEffect(() => {
    const deviceIds = Object.entries(notificationsByDevice)
      .filter(([, state]) => state.loaded && !state.loading)
      .map(([deviceId]) => deviceId);
    if (!deviceIds.length) {
      return;
    }

    const intervalId = window.setInterval(() => {
      deviceIds.forEach((deviceId) => {
        loadNotifications(deviceId).catch(() => {
          // Surface through normal loadNotifications error handling.
        });
      });
    }, 10_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [notificationsByDevice]);

  useEffect(() => {
    const deviceIds = Object.entries(callLogsByDevice)
      .filter(([, state]) => state.loaded && !state.loading)
      .map(([deviceId]) => deviceId);
    if (!deviceIds.length) {
      return;
    }

    const intervalId = window.setInterval(() => {
      deviceIds.forEach((deviceId) => {
        loadCallLogs(deviceId).catch(() => {
          // Surface through normal loadCallLogs error handling.
        });
      });
    }, 10_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [callLogsByDevice]);

  useEffect(() => {
    const deviceIds = Object.entries(cameraStreamsByDevice)
      .filter(([, state]) => state.loaded && !state.loading)
      .map(([deviceId]) => deviceId);
    if (!deviceIds.length) {
      return;
    }

    const intervalId = window.setInterval(() => {
      deviceIds.forEach((deviceId) => {
        loadCameraStream(deviceId).catch(() => {
          // Surface through normal loadCameraStream error handling.
        });
      });
    }, 2_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [cameraStreamsByDevice]);

  useEffect(() => {
    const socket = io(getApiBaseUrl(), {
      autoConnect: true
    });
    cameraSocketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("workspace.subscribe", { accessToken });
    });

    socket.on("camera.session.updated", (payload: CameraSessionUpdatedEvent) => {
      setCameraStreamsByDevice((current) => {
        const existing = current[payload.deviceId] ?? EMPTY_CAMERA_STREAM_STATE;
        return {
          ...current,
          [payload.deviceId]: {
            ...existing,
            session: payload.state,
            loading: false,
            loaded: true
          }
        };
      });
    });

    socket.on(
      "camera.viewer.signal",
      async (payload: CameraViewerSignal & { deviceId: string }) => {
        const deviceId = viewerToDeviceRef.current[payload.viewerId] ?? payload.deviceId;
        const connection = peerConnectionsRef.current[deviceId];
        if (!connection) {
          return;
        }

        try {
          if (payload.signal.type === "answer" && payload.signal.sdp) {
            await connection.setRemoteDescription({
              type: "answer",
              sdp: payload.signal.sdp
            });

            const queuedCandidates =
              pendingRemoteIceCandidatesRef.current[deviceId] ?? [];
            for (const queuedCandidate of queuedCandidates) {
              await connection.addIceCandidate(queuedCandidate);
            }
            pendingRemoteIceCandidatesRef.current[deviceId] = [];
            return;
          }

          if (payload.signal.type === "ice-candidate" && payload.signal.candidate) {
            const candidate: RTCIceCandidateInit = {
              candidate: payload.signal.candidate,
              sdpMid: payload.signal.sdpMid ?? undefined,
              sdpMLineIndex: payload.signal.sdpMLineIndex ?? undefined,
              usernameFragment: payload.signal.usernameFragment ?? undefined
            };
            const remoteDescriptionReady = Boolean(connection.remoteDescription?.type);
            if (!remoteDescriptionReady) {
              const queuedCandidates =
                pendingRemoteIceCandidatesRef.current[deviceId] ?? [];
              pendingRemoteIceCandidatesRef.current[deviceId] = [
                ...queuedCandidates,
                candidate
              ];
              return;
            }
            await connection.addIceCandidate(candidate);
          }
        } catch {
          setError(
            "WebRTC signaling failed while applying remote negotiation data. Try Start stream again."
          );
        }
      }
    );

    return () => {
      const connectedDeviceIds = new Set<string>([
        ...Object.keys(peerConnectionsRef.current),
        ...Object.values(viewerToDeviceRef.current)
      ]);
      connectedDeviceIds.forEach((deviceId) => {
        closeCameraViewer(deviceId, false);
      });
      socket.disconnect();
      cameraSocketRef.current = null;
    };
  }, [accessToken]);

  async function checkDeviceStatus(deviceId: string) {
    setError(null);
    setCheckingDeviceId(deviceId);

    try {
      const detail = await apiRequest<DeviceDetail>(`/devices/${deviceId}`, {
        accessToken
      });
      setDevices((currentDevices) =>
        currentDevices.map((device) => (device.id === deviceId ? detail : device))
      );
    } catch (statusError) {
      setError(
        statusError instanceof Error
          ? statusError.message
          : "Could not check device status."
      );
    } finally {
      setCheckingDeviceId(null);
    }
  }

  async function unpairDevice(deviceId: string) {
    setError(null);
    setActiveDeviceId(deviceId);

    try {
      closeCameraViewer(deviceId);
      const detail = await apiRequest<DeviceDetail>(`/devices/${deviceId}/revoke-session`, {
        method: "POST",
        accessToken
      });
      setDevices((currentDevices) =>
        currentDevices.map((device) => (device.id === deviceId ? detail : device))
      );
      setCameraStreamsByDevice((current) => {
        const next = { ...current };
        delete next[deviceId];
        return next;
      });
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not unpair the device."
      );
    } finally {
      setActiveDeviceId(null);
    }
  }

  async function removeDevice(deviceId: string) {
    setError(null);
    setRemovingDeviceId(deviceId);

    try {
      closeCameraViewer(deviceId);
      await apiRequest<{ success: boolean }>(`/devices/${deviceId}`, {
        method: "DELETE",
        accessToken
      });
      setDevices((currentDevices) =>
        currentDevices.filter((device) => device.id !== deviceId)
      );
      setTelemetryByDevice((current) => {
        const next = { ...current };
        delete next[deviceId];
        return next;
      });
      setNotificationsByDevice((current) => {
        const next = { ...current };
        delete next[deviceId];
        return next;
      });
      setCallLogsByDevice((current) => {
        const next = { ...current };
        delete next[deviceId];
        return next;
      });
      setCameraStreamsByDevice((current) => {
        const next = { ...current };
        delete next[deviceId];
        return next;
      });
      if (activeDeviceId === deviceId) {
        setActiveDeviceId(null);
      }
      if (checkingDeviceId === deviceId) {
        setCheckingDeviceId(null);
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not remove the device."
      );
    } finally {
      setRemovingDeviceId(null);
    }
  }

  async function loadTelemetry(deviceId: string) {
    setError(null);

    try {
      const telemetry = await apiRequest<DeviceTelemetryState>(`/devices/${deviceId}/telemetry`, {
        accessToken
      });
      setTelemetryByDevice((current) => ({
        ...current,
        [deviceId]: telemetry
      }));
    } catch (telemetryError) {
      setError(
        telemetryError instanceof Error
          ? telemetryError.message
          : "Could not load device telemetry."
      );
    }
  }

  function getNotificationsState(deviceId: string): DeviceNotificationsState {
    return notificationsByDevice[deviceId] ?? EMPTY_NOTIFICATIONS_STATE;
  }

  function getCallLogsState(deviceId: string): DeviceCallLogsState {
    return callLogsByDevice[deviceId] ?? EMPTY_CALL_LOGS_STATE;
  }

  function getCameraStreamState(deviceId: string): DeviceCameraStreamPanelState {
    return cameraStreamsByDevice[deviceId] ?? EMPTY_CAMERA_STREAM_STATE;
  }

  function updateNotificationsState(
    deviceId: string,
    updater: (current: DeviceNotificationsState) => DeviceNotificationsState
  ) {
    setNotificationsByDevice((current) => ({
      ...current,
      [deviceId]: updater(current[deviceId] ?? EMPTY_NOTIFICATIONS_STATE)
    }));
  }

  function updateCallLogsState(
    deviceId: string,
    updater: (current: DeviceCallLogsState) => DeviceCallLogsState
  ) {
    setCallLogsByDevice((current) => ({
      ...current,
      [deviceId]: updater(current[deviceId] ?? EMPTY_CALL_LOGS_STATE)
    }));
  }

  function updateCameraStreamPanelState(
    deviceId: string,
    updater: (current: DeviceCameraStreamPanelState) => DeviceCameraStreamPanelState
  ) {
    setCameraStreamsByDevice((current) => ({
      ...current,
      [deviceId]: updater(current[deviceId] ?? EMPTY_CAMERA_STREAM_STATE)
    }));
  }

  function setCameraVideoElement(deviceId: string, element: HTMLVideoElement | null) {
    videoElementsRef.current[deviceId] = element;
    const stream = remoteStreamsRef.current[deviceId];
    if (element) {
      element.srcObject = stream ?? null;
    }
  }

  function updateCameraFacingSelection(deviceId: string, value: "front" | "back") {
    updateCameraStreamPanelState(deviceId, (state) => ({
      ...state,
      selectedFacing: value
    }));
  }

  function updateCameraIncludeAudio(deviceId: string, value: boolean) {
    updateCameraStreamPanelState(deviceId, (state) => ({
      ...state,
      includeAudio: value
    }));
  }

  async function loadNotifications(
    deviceId: string,
    options?: {
      append?: boolean;
      appLabel?: string | null;
      appliedQuery?: string;
      cursor?: string | null;
    }
  ) {
    const append = options?.append ?? false;
    const currentState = getNotificationsState(deviceId);
    const appLabel =
      options && "appLabel" in options ? options.appLabel ?? null : currentState.appLabel;
    const appliedQuery =
      options?.appliedQuery !== undefined
        ? options.appliedQuery
        : currentState.appliedQuery;
    const cursor =
      options?.cursor !== undefined
        ? options.cursor
        : append
          ? currentState.nextCursor
          : null;

    updateNotificationsState(deviceId, (state) => ({
      ...state,
      loading: true
    }));

    try {
      const searchParams = new URLSearchParams();
      searchParams.set("limit", "20");

      if (cursor) {
        searchParams.set("cursor", cursor);
      }

      if (appLabel) {
        searchParams.set("appLabel", appLabel);
      }

      if (appliedQuery) {
        searchParams.set("query", appliedQuery);
      }

      const page = await apiRequest<NotificationsPage>(
        `/devices/${deviceId}/notifications?${searchParams.toString()}`,
        { accessToken }
      );

      updateNotificationsState(deviceId, (state) => ({
        ...state,
        loading: false,
        loaded: true,
        items: append ? [...state.items, ...page.items] : page.items,
        nextCursor: page.nextCursor,
        appGroups: page.appGroups
      }));
    } catch (notificationsError) {
      updateNotificationsState(deviceId, (state) => ({
        ...state,
        loading: false
      }));
      setError(
        notificationsError instanceof Error
          ? notificationsError.message
          : "Could not load notifications."
      );
    }
  }

  async function loadCallLogs(
    deviceId: string,
    options?: {
      append?: boolean;
      cursor?: string | null;
    }
  ) {
    const append = options?.append ?? false;
    const currentState = getCallLogsState(deviceId);
    const cursor =
      options?.cursor !== undefined
        ? options.cursor
        : append
          ? currentState.nextCursor
          : null;

    updateCallLogsState(deviceId, (state) => ({
      ...state,
      loading: true
    }));

    try {
      const searchParams = new URLSearchParams();
      searchParams.set("limit", "25");
      if (cursor) {
        searchParams.set("cursor", cursor);
      }

      const page = await apiRequest<CallLogsPage>(
        `/devices/${deviceId}/call-logs?${searchParams.toString()}`,
        { accessToken }
      );

      updateCallLogsState(deviceId, (state) => ({
        ...state,
        loading: false,
        loaded: true,
        items: append ? [...state.items, ...page.items] : page.items,
        nextCursor: page.nextCursor
      }));
    } catch (callLogsError) {
      updateCallLogsState(deviceId, (state) => ({
        ...state,
        loading: false
      }));
      setError(
        callLogsError instanceof Error
          ? callLogsError.message
          : "Could not load call logs."
      );
    }
  }

  async function loadCameraStream(deviceId: string) {
    updateCameraStreamPanelState(deviceId, (state) => ({
      ...state,
      loading: true
    }));

    try {
      const state = await apiRequest<CameraStreamSessionState>(
        `/devices/${deviceId}/camera-stream/session`,
        {
          accessToken,
          timeoutMs: 20_000
        }
      );

      updateCameraStreamPanelState(deviceId, (current) => ({
        ...current,
        session: state,
        loading: false,
        loaded: true
      }));
    } catch (cameraStreamError) {
      const message =
        cameraStreamError instanceof Error ? cameraStreamError.message : "";
      if (/404|not found/i.test(message)) {
        closeCameraViewer(deviceId, false);
        setCameraStreamsByDevice((current) => {
          const next = { ...current };
          delete next[deviceId];
          return next;
        });
        return;
      }
      updateCameraStreamPanelState(deviceId, (state) => ({
        ...state,
        loading: false
      }));
      setError(
        message || "Could not load the camera stream."
      );
    }
  }

  async function fetchCameraStreamState(deviceId: string) {
    return apiRequest<CameraStreamSessionState>(
      `/devices/${deviceId}/camera-stream/session`,
      {
        accessToken,
        timeoutMs: 20_000
      }
    );
  }

  async function waitForCameraStreamReady(
    deviceId: string,
    initialState: CameraStreamSessionState
  ) {
    if (!initialState.sessionId) {
      throw new Error("Camera session did not return a valid session id.");
    }

    let latestState = initialState;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      }

      const nextState = await fetchCameraStreamState(deviceId);
      latestState = nextState;
      updateCameraStreamPanelState(deviceId, (current) => ({
        ...current,
        session: nextState,
        loading: false,
        loaded: true
      }));

      if (
        nextState.status === "activation_blocked" ||
        nextState.status === "failed"
      ) {
        throw new Error(
          resolveCameraErrorMessage(
            nextState,
            "The device could not activate the camera stream."
          )
        );
      }

      if (!nextState.sessionId) {
        throw new Error(
          resolveCameraErrorMessage(
            nextState,
            "The camera session ended before signaling became ready."
          )
        );
      }

      if (nextState.sessionId !== initialState.sessionId) {
        continue;
      }

      if (nextState.signalingReady) {
        return nextState;
      }
    }

    throw new Error(
      resolveCameraErrorMessage(
        latestState,
        "The device did not acknowledge the camera stream request in time."
      )
    );
  }

  function getOrCreateCameraSocket() {
    const socket = cameraSocketRef.current;
    if (!socket) {
      throw new Error("Camera signaling socket is not connected.");
    }
    if (!socket.connected) {
      socket.connect();
    }
    return socket;
  }

  function clearViewerTimeout(deviceId: string) {
    const timeoutId = viewerTimeoutsRef.current[deviceId];
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      delete viewerTimeoutsRef.current[deviceId];
    }
  }

  function clearAudioFallbackPollTimeout(deviceId: string) {
    const timeoutId = audioFallbackPollTimeoutsRef.current[deviceId];
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      delete audioFallbackPollTimeoutsRef.current[deviceId];
    }
  }

  function scheduleAudioFallbackPoll(
    deviceId: string,
    viewerId: string,
    delayMs: number
  ) {
    clearAudioFallbackPollTimeout(deviceId);
    audioFallbackPollTimeoutsRef.current[deviceId] = window.setTimeout(() => {
      void pollAudioFallback(deviceId, viewerId);
    }, delayMs);
  }

  async function ensureAudioContext(deviceId: string) {
    const existingContext = audioContextsRef.current[deviceId];
    if (existingContext) {
      if (existingContext.state === "suspended") {
        await existingContext.resume();
      }
      return existingContext;
    }

    const ContextCtor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!ContextCtor) {
      throw new Error("This browser does not support Web Audio API playback.");
    }

    const nextContext = new ContextCtor();
    if (nextContext.state === "suspended") {
      await nextContext.resume();
    }

    audioContextsRef.current[deviceId] = nextContext;
    return nextContext;
  }

  async function fetchAudioFallbackChunks(deviceId: string, sinceSeq: number) {
    const response = await fetch(
      `/api/camera-stream/${deviceId}/audio?accessToken=${encodeURIComponent(
        accessToken
      )}&sinceSeq=${sinceSeq}&limit=10`,
      {
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error(`Audio fallback request failed with status ${response.status}`);
    }

    return (await response.json()) as CameraStreamAudioPollResponse;
  }

  async function pollAudioFallback(deviceId: string, viewerId: string) {
    if (!audioFallbackEnabledRef.current[deviceId]) {
      return;
    }

    const expectedViewerId = audioFallbackViewerRef.current[deviceId];
    if (expectedViewerId && expectedViewerId !== viewerId) {
      return;
    }

    const panelState = getCameraStreamState(deviceId);
    if (panelState.viewerId !== viewerId || panelState.transport !== "mjpeg") {
      scheduleAudioFallbackPoll(deviceId, viewerId, 120);
      return;
    }

    const sinceSeq = audioFallbackSinceSeqRef.current[deviceId] ?? 0;

    try {
      const payload = await fetchAudioFallbackChunks(deviceId, sinceSeq);
      audioFallbackSinceSeqRef.current[deviceId] = payload.latestServerSequence;

      if (payload.chunks.length > 0) {
        const context = await ensureAudioContext(deviceId);
        let nextPlayAt =
          audioFallbackNextPlayAtRef.current[deviceId] ?? context.currentTime + 0.04;

        if (nextPlayAt < context.currentTime + 0.02) {
          nextPlayAt = context.currentTime + 0.02;
        }
        if (nextPlayAt > context.currentTime + 1.5) {
          nextPlayAt = context.currentTime + 0.04;
        }

        payload.chunks.forEach((chunk) => {
          const samples = decodePcm16Base64ToFloat32(chunk.pcm16Base64);
          if (!samples.length) {
            return;
          }

          const audioBuffer = context.createBuffer(1, samples.length, chunk.sampleRateHz);
          audioBuffer.getChannelData(0).set(samples);
          const source = context.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(context.destination);
          source.start(nextPlayAt);
          nextPlayAt += audioBuffer.duration;
        });

        audioFallbackNextPlayAtRef.current[deviceId] = nextPlayAt;
        updateCameraStreamPanelState(deviceId, (current) => ({
          ...current,
          audioFallbackActive: true,
          audioFallbackError: null,
          audioFallbackLastChunkAt:
            payload.chunks.at(-1)?.capturedAt ?? current.audioFallbackLastChunkAt
        }));
      } else {
        updateCameraStreamPanelState(deviceId, (current) => ({
          ...current,
          audioFallbackActive: true,
          audioFallbackError: null
        }));
      }

      scheduleAudioFallbackPoll(deviceId, viewerId, 120);
    } catch (error) {
      if (!audioFallbackEnabledRef.current[deviceId]) {
        return;
      }

      updateCameraStreamPanelState(deviceId, (current) => ({
        ...current,
        audioFallbackActive: false,
        audioFallbackError:
          error instanceof Error
            ? error.message
            : "Audio fallback polling failed."
      }));
      scheduleAudioFallbackPoll(deviceId, viewerId, 600);
    }
  }

  async function startAudioFallback(deviceId: string, viewerId: string) {
    stopAudioFallback(deviceId);
    audioFallbackEnabledRef.current[deviceId] = true;
    audioFallbackViewerRef.current[deviceId] = viewerId;
    audioFallbackSinceSeqRef.current[deviceId] = 0;
    audioFallbackNextPlayAtRef.current[deviceId] = 0;

    try {
      await ensureAudioContext(deviceId);
      updateCameraStreamPanelState(deviceId, (current) => ({
        ...current,
        audioFallbackActive: true,
        audioFallbackError: null
      }));
      await pollAudioFallback(deviceId, viewerId);
    } catch (error) {
      updateCameraStreamPanelState(deviceId, (current) => ({
        ...current,
        audioFallbackActive: false,
        audioFallbackError:
          error instanceof Error ? error.message : "Audio fallback unavailable."
      }));
    }
  }

  function stopAudioFallback(deviceId: string) {
    audioFallbackEnabledRef.current[deviceId] = false;
    delete audioFallbackViewerRef.current[deviceId];
    clearAudioFallbackPollTimeout(deviceId);
    delete audioFallbackSinceSeqRef.current[deviceId];
    delete audioFallbackNextPlayAtRef.current[deviceId];

    const context = audioContextsRef.current[deviceId];
    if (context) {
      void context.close().catch(() => {
        // Best-effort cleanup.
      });
      delete audioContextsRef.current[deviceId];
    }

    updateCameraStreamPanelState(deviceId, (current) => ({
      ...current,
      audioFallbackActive: false,
      audioFallbackError: null,
      audioFallbackLastChunkAt: null
    }));
  }

  function closeCameraViewer(deviceId: string, leaveViewer = true) {
    clearViewerTimeout(deviceId);
    stopAudioFallback(deviceId);

    const state = getCameraStreamState(deviceId);
    if (leaveViewer && state.viewerId && cameraSocketRef.current?.connected) {
      cameraSocketRef.current.emit("camera.viewer.leave", {
        deviceId,
        viewerId: state.viewerId
      });
      delete viewerToDeviceRef.current[state.viewerId];
    }

    peerConnectionsRef.current[deviceId]?.close();
    delete peerConnectionsRef.current[deviceId];

    const stream = remoteStreamsRef.current[deviceId];
    stream?.getTracks().forEach((track) => track.stop());
    delete remoteStreamsRef.current[deviceId];
    delete pendingRemoteIceCandidatesRef.current[deviceId];

    const videoElement = videoElementsRef.current[deviceId];
    if (videoElement) {
      videoElement.srcObject = null;
    }

    updateCameraStreamPanelState(deviceId, (current) => ({
      ...current,
      viewerId: leaveViewer ? null : current.viewerId,
      transport: null,
      mjpegUrl: null
    }));
  }

  function switchToMjpegFallback(
    deviceId: string,
    viewerId: string,
    includeAudio: boolean
  ) {
    const socket = cameraSocketRef.current;
    if (socket?.connected) {
      socket.emit("camera.viewer.transport", {
        deviceId,
        viewerId,
        transport: "mjpeg"
      });
    }

    peerConnectionsRef.current[deviceId]?.close();
    delete peerConnectionsRef.current[deviceId];

    updateCameraStreamPanelState(deviceId, (current) => ({
      ...current,
      transport: "mjpeg",
      mjpegUrl: `/api/camera-stream/${deviceId}/mjpeg?accessToken=${encodeURIComponent(
        accessToken
      )}&viewerId=${viewerId}&ts=${Date.now()}`
    }));

    if (includeAudio) {
      void startAudioFallback(deviceId, viewerId);
    } else {
      stopAudioFallback(deviceId);
    }
  }

  async function joinCameraViewer(
    socket: Socket,
    deviceId: string,
    viewerId: string
  ): Promise<CameraStreamSessionState> {
    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error("Timed out while joining the camera viewer."));
      }, 8_000);

      const cleanup = () => {
        window.clearTimeout(timeoutId);
        socket.off("camera.viewer.join.ok", handleJoinOk);
        socket.off("camera.viewer.join.failed", handleJoinFailed);
      };

      const handleJoinOk = (payload: {
        deviceId: string;
        viewerId: string;
        state: CameraStreamSessionState;
      }) => {
        if (payload.deviceId !== deviceId || payload.viewerId !== viewerId) {
          return;
        }
        cleanup();
        resolve(payload.state);
      };

      const handleJoinFailed = (payload: {
        deviceId: string;
        viewerId: string;
        message?: string;
      }) => {
        if (payload.deviceId !== deviceId || payload.viewerId !== viewerId) {
          return;
        }
        cleanup();
        reject(
          new Error(payload.message || "Could not join the camera viewer.")
        );
      };

      socket.on("camera.viewer.join.ok", handleJoinOk);
      socket.on("camera.viewer.join.failed", handleJoinFailed);
      socket.emit("camera.viewer.join", {
        deviceId,
        viewerId
      });
    });
  }

  async function connectCameraViewer(
    deviceId: string,
    sessionState: CameraStreamSessionState
  ) {
    if (!sessionState.sessionId) {
      throw new Error("Camera session is not ready yet.");
    }

    closeCameraViewer(deviceId);

    const socket = getOrCreateCameraSocket();
    const viewerId = crypto.randomUUID();
    viewerToDeviceRef.current[viewerId] = deviceId;
    let joinedState: CameraStreamSessionState;
    try {
      joinedState = await joinCameraViewer(socket, deviceId, viewerId);
    } catch (error) {
      delete viewerToDeviceRef.current[viewerId];
      throw error;
    }

    const connection = new RTCPeerConnection({
      iceServers: joinedState.iceServers.map((server) => ({
        urls: server.urls,
        username: server.username,
        credential: server.credential
      }))
    });
    const remoteStream = new MediaStream();
    remoteStreamsRef.current[deviceId] = remoteStream;
    peerConnectionsRef.current[deviceId] = connection;
    pendingRemoteIceCandidatesRef.current[deviceId] = [];

    const videoElement = videoElementsRef.current[deviceId];
    if (videoElement) {
      videoElement.srcObject = remoteStream;
    }

    connection.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((track) => {
        if (!remoteStream.getTracks().some((existing) => existing.id === track.id)) {
          remoteStream.addTrack(track);
        }
      });
      const element = videoElementsRef.current[deviceId];
      if (element) {
        element.srcObject = remoteStream;
        if (joinedState.includeAudio) {
          element.muted = false;
        }
        void element.play().catch(() => {
          if (joinedState.includeAudio) {
            setError(
              "Browser blocked autoplay with audio. Click the live feed once to enable sound."
            );
          }
        });
      }
    };

    connection.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      socket.emit("camera.viewer.signal", {
        deviceId,
        viewerId,
        signal: {
          type: "ice-candidate",
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          usernameFragment: event.candidate.usernameFragment
        }
      });
    };

    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "connected") {
        clearViewerTimeout(deviceId);
        stopAudioFallback(deviceId);
        socket.emit("camera.viewer.transport", {
          deviceId,
          viewerId,
          transport: "webrtc"
        });
        updateCameraStreamPanelState(deviceId, (current) => ({
          ...current,
          viewerId,
          transport: "webrtc",
          mjpegUrl: null
        }));
      }

      if (
        connection.connectionState === "failed" ||
        connection.connectionState === "disconnected" ||
        connection.connectionState === "closed"
      ) {
        switchToMjpegFallback(deviceId, viewerId, joinedState.includeAudio);
        if (joinedState.includeAudio) {
          setError(
            "WebRTC audio could not stay connected. Switched to MJPEG video with PCM fallback audio."
          );
        }
      }
    };

    connection.addTransceiver("video", { direction: "recvonly" });
    if (joinedState.includeAudio) {
      connection.addTransceiver("audio", { direction: "recvonly" });
    }

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    socket.emit("camera.viewer.signal", {
      deviceId,
      viewerId,
      signal: {
        type: "offer",
        sdp: offer.sdp
      }
    });

    updateCameraStreamPanelState(deviceId, (current) => ({
      ...current,
      viewerId,
      transport: null,
      mjpegUrl: null
    }));

    viewerTimeoutsRef.current[deviceId] = window.setTimeout(() => {
      const currentState = getCameraStreamState(deviceId);
      if (currentState.viewerId === viewerId && currentState.transport !== "webrtc") {
        switchToMjpegFallback(deviceId, viewerId, joinedState.includeAudio);
        if (joinedState.includeAudio) {
          setError(
            "WebRTC audio negotiation timed out. Switched to MJPEG video with PCM fallback audio."
          );
        }
      }
    }, 24_000);
  }

  async function connectMjpegViewer(
    deviceId: string,
    sessionState: CameraStreamSessionState
  ) {
    if (!sessionState.sessionId) {
      throw new Error("Camera session is not ready yet.");
    }

    closeCameraViewer(deviceId);

    const socket = getOrCreateCameraSocket();
    const viewerId = crypto.randomUUID();
    viewerToDeviceRef.current[viewerId] = deviceId;

    try {
      await joinCameraViewer(socket, deviceId, viewerId);
    } catch (error) {
      delete viewerToDeviceRef.current[viewerId];
      throw error;
    }

    updateCameraStreamPanelState(deviceId, (current) => ({
      ...current,
      viewerId
    }));
    switchToMjpegFallback(deviceId, viewerId, sessionState.includeAudio);
  }

  function updateNotificationDraft(deviceId: string, value: string) {
    updateNotificationsState(deviceId, (state) => ({
      ...state,
      draftQuery: value
    }));
  }

  function applyNotificationFilters(deviceId: string, nextAppLabel?: string | null) {
    const nextState = getNotificationsState(deviceId);
    const appliedQuery = nextState.draftQuery.trim();
    const appLabel = nextAppLabel !== undefined ? nextAppLabel : nextState.appLabel;

    updateNotificationsState(deviceId, (state) => ({
      ...state,
      loaded: false,
      items: [],
      nextCursor: null,
      appLabel,
      appliedQuery
    }));

    loadNotifications(deviceId, {
      appLabel,
      appliedQuery,
      cursor: null
    }).catch(() => {
      // Errors are surfaced by loadNotifications.
    });
  }

  async function refreshNotificationsFromDevice(deviceId: string) {
    setError(null);
    setCommandingDeviceId(deviceId);

    try {
      await apiRequest(`/devices/${deviceId}/commands`, {
        method: "POST",
        accessToken,
        body: {
          type: "device.refresh_notifications",
          payload: { reason: "dashboard_refresh_notifications" }
        } satisfies CreateDeviceCommandRequest
      });
      [2_500, 5_000, 8_000, 15_000, 30_000].forEach((delayMs) => {
        window.setTimeout(() => {
          loadNotifications(deviceId).catch(() => {
            // Surface through normal loadNotifications error handling.
          });
        }, delayMs);
      });
    } catch (commandError) {
      setError(
        commandError instanceof Error
          ? commandError.message
          : "Could not refresh notifications from the device."
      );
    } finally {
      setCommandingDeviceId(null);
    }
  }

  async function refreshCallLogsFromDevice(deviceId: string) {
    setError(null);
    setCommandingDeviceId(deviceId);

    try {
      await apiRequest(`/devices/${deviceId}/commands`, {
        method: "POST",
        accessToken,
        body: {
          type: "device.refresh_call_logs",
          payload: { reason: "dashboard_refresh_call_logs" }
        } satisfies CreateDeviceCommandRequest
      });
      [2_500, 5_000, 8_000, 15_000, 30_000].forEach((delayMs) => {
        window.setTimeout(() => {
          loadCallLogs(deviceId).catch(() => {
            // Surface through normal loadCallLogs error handling.
          });
        }, delayMs);
      });
    } catch (commandError) {
      setError(
        commandError instanceof Error
          ? commandError.message
          : "Could not refresh call logs from the device."
      );
    } finally {
        setCommandingDeviceId(null);
    }
  }

  async function startCameraStream(deviceId: string) {
    setError(null);
    setCommandingDeviceId(deviceId);

    try {
      const currentState = getCameraStreamState(deviceId);
      const preferredTransport = resolvePreferredCameraTransport(
        currentState.includeAudio
      );
      if (currentState.includeAudio && preferredTransport !== "webrtc") {
        setError(
          "WebRTC native transport is disabled for stability. Starting MJPEG video with PCM fallback audio."
        );
      }
      const sessionState = await apiRequest<CameraStreamSessionState>(
        `/devices/${deviceId}/camera-stream/session`,
        {
          method: "POST",
          accessToken,
          body: {
            cameraFacing: currentState.selectedFacing,
            includeAudio: currentState.includeAudio,
            preferredTransport
          } satisfies CameraStreamSessionRequest
        }
      );

      updateCameraStreamPanelState(deviceId, (state) => ({
        ...state,
        session: sessionState,
        loaded: true,
        transport: null,
        mjpegUrl: null
      }));
      const readyState = await waitForCameraStreamReady(deviceId, sessionState);
      if (readyState.preferredTransport === "mjpeg") {
        await connectMjpegViewer(deviceId, readyState);
      } else {
        await connectCameraViewer(deviceId, readyState);
      }

      [500, 1_500, 3_000, 6_000].forEach((delayMs) => {
        window.setTimeout(() => {
          loadCameraStream(deviceId).catch(() => {
            // Surface through normal loadCameraStream error handling.
          });
        }, delayMs);
      });
    } catch (commandError) {
      setError(
        commandError instanceof Error
          ? commandError.message
          : "Could not start the camera stream."
      );
    } finally {
      setCommandingDeviceId(null);
    }
  }

  async function stopCameraStream(deviceId: string) {
    setError(null);
    setCommandingDeviceId(deviceId);

    try {
      closeCameraViewer(deviceId);
      await apiRequest(`/devices/${deviceId}/camera-stream/session`, {
        method: "DELETE",
        accessToken
      });
      [500, 1_500, 3_000].forEach((delayMs) => {
        window.setTimeout(() => {
          loadCameraStream(deviceId).catch(() => {
            // Surface through normal loadCameraStream error handling.
          });
        }, delayMs);
      });
    } catch (commandError) {
      setError(
        commandError instanceof Error
          ? commandError.message
          : "Could not stop the camera stream."
      );
    } finally {
      setCommandingDeviceId(null);
    }
  }

  async function sendDeviceCommand(
    deviceId: string,
    payload: CreateDeviceCommandRequest
  ) {
    setError(null);
    setCommandingDeviceId(deviceId);

    try {
      await apiRequest(`/devices/${deviceId}/commands`, {
        method: "POST",
        accessToken,
        body: payload
      });
      const reloadDelays =
        payload.type === "device.get_location" ? [2_500, 5_000, 8_000, 15_000] : [1_000];
      reloadDelays.forEach((delayMs) => {
        window.setTimeout(() => {
          loadTelemetry(deviceId).catch(() => {
            // Surface through normal loadTelemetry error handling.
          });
        }, delayMs);
      });
    } catch (commandError) {
      setError(
        commandError instanceof Error
          ? commandError.message
          : "Could not send the device command."
      );
    } finally {
      setCommandingDeviceId(null);
    }
  }

  async function clearNotifications(deviceId: string) {
    setError(null);
    setClearingNotificationsDeviceId(deviceId);

    try {
      await apiRequest<{ success: boolean }>(`/devices/${deviceId}/notifications`, {
        method: "DELETE",
        accessToken
      });
      setNotificationsByDevice((current) => ({
        ...current,
        [deviceId]: {
          ...EMPTY_NOTIFICATIONS_STATE,
          loaded: true
        }
      }));
    } catch (clearError) {
      setError(
        clearError instanceof Error
          ? clearError.message
          : "Could not clear notifications."
      );
    } finally {
      setClearingNotificationsDeviceId(null);
    }
  }

  async function clearCallLogs(deviceId: string) {
    setError(null);
    setClearingCallLogsDeviceId(deviceId);

    try {
      await apiRequest<{ success: boolean }>(`/devices/${deviceId}/call-logs`, {
        method: "DELETE",
        accessToken
      });
      setCallLogsByDevice((current) => ({
        ...current,
        [deviceId]: {
          ...EMPTY_CALL_LOGS_STATE,
          loaded: true
        }
      }));
    } catch (clearError) {
      setError(
        clearError instanceof Error
          ? clearError.message
          : "Could not clear call logs."
      );
    } finally {
      setClearingCallLogsDeviceId(null);
    }
  }

  async function handleSignOut() {
    await clearSession();
  }

  async function resolvePairingApiBaseUrl() {
    const apiBaseUrl = getApiBaseUrl();
    const parsedUrl = new URL(apiBaseUrl);

    if (!shouldResolveLanIp(parsedUrl.hostname)) {
      return apiBaseUrl;
    }

    try {
      const response = await fetch("/api/local-ip", {
        cache: "no-store"
      });

      if (!response.ok) {
        return apiBaseUrl;
      }

      const payload = (await response.json()) as { ip?: string | null };

      if (!payload.ip) {
        return apiBaseUrl;
      }

      parsedUrl.hostname = payload.ip;
      return parsedUrl.toString().replace(/\/$/, "");
    } catch {
      return apiBaseUrl;
    }
  }

  return (
    <main className="page-shell" style={{ padding: "28px 0 48px" }}>
      <section className="stack" style={{ gap: 20 }}>
        <header
          className="glass-panel"
          style={{
            borderRadius: "32px",
            padding: 28,
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap"
          }}
        >
          <div className="stack" style={{ gap: 8 }}>
            <span className="pill">Workspace owner</span>
            <h1 style={{ margin: 0 }}>{session.workspace.name}</h1>
            <p className="muted" style={{ margin: 0 }}>
              Signed in as {session.user.displayName} ({session.user.email})
            </p>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button className="button-primary" onClick={createPairingCode} type="button">
              Generate pairing code
            </button>
            <button className="button-secondary" onClick={refreshRegistryNow} type="button">
              Check device status
            </button>
            <button className="button-secondary" onClick={handleSignOut} type="button">
              Sign out
            </button>
            <Link className="button-secondary" href="/">
              Home
            </Link>
          </div>
        </header>

        {error ? (
          <div
            style={{
              padding: 16,
              borderRadius: 18,
              background: "rgba(197,79,45,0.12)",
              color: "var(--accent)"
            }}
          >
            {error}
          </div>
        ) : null}

        {isPairingStationOpen ? (
          <section
            className="glass-panel"
            style={{ borderRadius: "32px", padding: 28, display: "grid", gap: 18 }}
          >
            <div className="pill">Pairing station</div>
            <h2 style={{ margin: 0 }}>Connect a managed Android device</h2>
            <p className="muted" style={{ margin: 0 }}>
              Generate a one-time six-letter code in the dashboard, then enter it in
              the Android client or scan the matching QR code to establish a trusted
              device session.
            </p>

            <div className="pairing-options">
              {pairingCode ? (
                <>
                  <div
                    style={{
                      padding: 24,
                      borderRadius: 24,
                      border: "1px solid var(--line)",
                      background: "var(--panel-strong)",
                      minHeight: 188,
                      display: "grid",
                      alignContent: "center",
                      gap: 14
                    }}
                  >
                    <div className="pill">Alphabetic code</div>
                    <div className="code-chip">{pairingCode.code}</div>
                    <p className="muted" style={{ marginBottom: 0 }}>
                      Expires at {new Date(pairingCode.expiresAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="qr-panel">
                    <div className="pill">QR pairing</div>
                    {pairingQrUrl ? (
                      <img
                        alt={`SafeLens QR code for pairing code ${pairingCode.code}`}
                        className="qr-image"
                        src={pairingQrUrl}
                      />
                    ) : (
                      <div className="qr-placeholder">Preparing QR code...</div>
                    )}
                    <p className="muted" style={{ margin: 0 }}>
                      Open the Android app and scan this QR code to fill the pairing
                      details automatically.
                    </p>
                  </div>
                </>
              ) : (
                <div
                  style={{
                    padding: 24,
                    borderRadius: 24,
                    border: "1px solid var(--line)",
                    background: "var(--panel-strong)",
                    minHeight: 188,
                    display: "grid",
                    alignContent: "center",
                    gap: 14
                  }}
                >
                  <p className="muted" style={{ margin: 0 }}>
                    No active code yet. Generate one when a device is ready to pair.
                  </p>
                </div>
              )}
            </div>
          </section>
        ) : null}

        <section
          className="glass-panel"
          style={{ borderRadius: "32px", padding: 28, display: "grid", gap: 18 }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center"
            }}
          >
            <div>
              <div className="pill" style={{ marginBottom: 8 }}>
                Camera stream
              </div>
              <p className="muted" style={{ margin: 0 }}>
                Start a low-latency live frame stream from the paired Android device.
              </p>
            </div>
          </div>
          {devices.length ? (
            <div className="card-grid">
              {devices.map((device) => {
                const cameraStream = getCameraStreamState(device.id);
                const streamState = cameraStream.session;
                const isActivationBlocked = streamState?.status === "activation_blocked";
                const streamErrorMessage = resolveCameraErrorMessage(streamState, "");
                const showMjpeg = cameraStream.transport === "mjpeg" && cameraStream.mjpegUrl;
                const effectiveCameraFacing =
                  streamState?.cameraFacing ?? cameraStream.selectedFacing;
                const cameraRotationDegrees = getCameraRotationDegrees(
                  effectiveCameraFacing
                );

                return (
                  <article
                    key={`camera-stream-${device.id}`}
                    style={{
                      padding: 18,
                      borderRadius: 24,
                      background: "rgba(255,255,255,0.74)",
                      border: "1px solid var(--line)",
                      display: "grid",
                      gap: 12
                    }}
                  >
                    <div>
                      <h3 style={{ margin: "0 0 4px" }}>{device.name}</h3>
                      <p className="muted" style={{ margin: 0 }}>
                        {device.manufacturer} {device.model}
                      </p>
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <label className="pill" style={{ display: "flex", gap: 8 }}>
                        Camera
                        <select
                          onChange={(event) =>
                            updateCameraFacingSelection(
                              device.id,
                              event.target.value as "front" | "back"
                            )
                          }
                          value={cameraStream.selectedFacing}
                        >
                          <option value="back">Back</option>
                          <option value="front">Front</option>
                        </select>
                      </label>
                      <label className="pill" style={{ display: "flex", gap: 8 }}>
                        <input
                          checked={cameraStream.includeAudio}
                          onChange={(event) =>
                            updateCameraIncludeAudio(device.id, event.target.checked)
                          }
                          type="checkbox"
                        />
                        Audio
                      </label>
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button
                        className="button-secondary"
                        disabled={commandingDeviceId === device.id}
                        onClick={() => startCameraStream(device.id)}
                        type="button"
                      >
                        {commandingDeviceId === device.id ? "Starting..." : "Start stream"}
                      </button>
                      <button
                        className="button-secondary"
                        disabled={commandingDeviceId === device.id}
                        onClick={() => stopCameraStream(device.id)}
                        type="button"
                      >
                        Stop stream
                      </button>
                      <button
                        className="button-secondary"
                        disabled={cameraStream.loading}
                        onClick={() => loadCameraStream(device.id)}
                        type="button"
                      >
                        {cameraStream.loading ? "Refreshing..." : "Refresh stream"}
                      </button>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <div
                        className={
                          streamState &&
                          streamState.status !== "idle" &&
                          streamState.status !== "failed" &&
                          streamState.status !== "activation_blocked"
                            ? "status-online"
                            : "status-planned"
                        }
                      >
                        {streamState?.status ?? "idle"}
                      </div>
                      {cameraStream.transport ? (
                        <div className="pill">
                          {cameraStream.transport === "webrtc"
                            ? "WebRTC"
                            : "MJPEG fallback"}
                        </div>
                      ) : null}
                      {streamState?.activeTransport ? (
                        <div className="pill">
                          Active {streamState.activeTransport === "webrtc" ? "WebRTC" : "MJPEG"}
                        </div>
                      ) : null}
                      {cameraStream.audioFallbackActive ? (
                        <div className="pill">PCM audio fallback</div>
                      ) : null}
                      {streamState?.cameraFacing ? (
                        <div className="pill">
                          {streamState.cameraFacing === "front"
                            ? "Front camera"
                            : "Back camera"}
                        </div>
                      ) : null}
                      {streamState ? (
                        <div className="pill">{streamState.viewerCount} viewers</div>
                      ) : null}
                      {streamState?.lastFrameAt ? (
                        <div className="pill">
                          Last frame {new Date(streamState.lastFrameAt).toLocaleTimeString()}
                        </div>
                      ) : null}
                    </div>

                    {cameraStream.transport === "webrtc" ? (
                      <div
                        className="camera-feed-shell"
                      >
                        <div className="pill">Live feed frame</div>
                        <div className="camera-feed-stage">
                        <video
                          autoPlay
                          controls={cameraStream.includeAudio}
                          muted={!cameraStream.includeAudio}
                          onClick={(event) => {
                            if (!cameraStream.includeAudio) {
                              return;
                            }
                            const element = event.currentTarget;
                            element.muted = false;
                            void element.play().catch(() => {
                              setError(
                                "Audio playback is blocked by the browser. Use the video controls to unmute and play."
                              );
                            });
                          }}
                          playsInline
                          ref={(element) => setCameraVideoElement(device.id, element)}
                          className="camera-feed-media"
                          style={{ transform: `rotate(${cameraRotationDegrees}deg)` }}
                        />
                        </div>
                      </div>
                    ) : showMjpeg ? (
                      <div
                        className="camera-feed-shell"
                      >
                        <div className="pill">Live feed frame</div>
                        <div className="camera-feed-stage">
                        <img
                          alt={`Fallback MJPEG stream from ${device.name}`}
                          src={cameraStream.mjpegUrl ?? undefined}
                          className="camera-feed-media"
                          style={{ transform: `rotate(${cameraRotationDegrees}deg)` }}
                        />
                        </div>
                      </div>
                    ) : (
                      <p className="muted" style={{ margin: 0 }}>
                        {cameraStream.loading
                          ? "Loading camera stream state..."
                          : isActivationBlocked
                            ? resolveCameraErrorMessage(
                                streamState,
                                "Android blocked silent camera activation for this device."
                              )
                            : "No live camera session yet. Start the stream to connect."}
                      </p>
                    )}

                    <div style={{ display: "grid", gap: 6 }}>
                      <p className="muted" style={{ margin: 0 }}>
                        Preferred transport {streamState?.preferredTransport ?? "webrtc"}
                      </p>
                      <p className="muted" style={{ margin: 0 }}>
                        {streamState?.updatedAt
                          ? `Updated ${new Date(streamState.updatedAt).toLocaleString()}`
                          : "No stream update yet"}
                      </p>
                      <p className="muted" style={{ margin: 0 }}>
                        Audio{" "}
                        {streamState?.includeAudio
                          ? streamState.audioAvailable
                            ? "requested and available"
                            : "requested but unavailable on the phone"
                          : "off"}
                      </p>
                      <p className="muted" style={{ margin: 0 }}>
                        {cameraStream.transport === "webrtc"
                          ? "Audio path: WebRTC track."
                          : cameraStream.audioFallbackActive
                            ? "Audio path: PCM fallback over MJPEG session."
                            : "Audio path: waiting for fallback chunks."}
                      </p>
                      {cameraStream.audioFallbackLastChunkAt ? (
                        <p className="muted" style={{ margin: 0 }}>
                          Last audio chunk{" "}
                          {new Date(
                            cameraStream.audioFallbackLastChunkAt
                          ).toLocaleTimeString()}
                        </p>
                      ) : null}
                      {cameraStream.audioFallbackError ? (
                        <p style={{ margin: 0, color: "var(--accent)" }}>
                          {cameraStream.audioFallbackError}
                        </p>
                      ) : null}
                      {streamErrorMessage ? (
                        <p style={{ margin: 0, color: "var(--accent)" }}>
                          {streamErrorMessage}
                        </p>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Pair a device first to use the camera stream.
            </p>
          )}
        </section>

        <section
          className="glass-panel"
          style={{ borderRadius: "32px", padding: 28, display: "grid", gap: 18 }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center"
            }}
          >
            <div className="pill">Device registry</div>
            <p className="muted" style={{ margin: 0 }}>
              {devices.length} device{devices.length === 1 ? "" : "s"} linked
            </p>
          </div>
          {loading ? (
            <p className="muted" style={{ margin: 0 }}>
              Loading devices...
            </p>
          ) : devices.length ? (
            <div className="card-grid">
              {devices.map((device) => {
                const telemetry = telemetryByDevice[device.id];

                return (
                  <article
                    key={device.id}
                    style={{
                      padding: 18,
                      borderRadius: 24,
                      background: "rgba(255,255,255,0.74)",
                      border: "1px solid var(--line)",
                      display: "grid",
                      gap: 12
                    }}
                  >
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <div className={device.isPaired ? "status-online" : "status-planned"}>
                      {device.isPaired ? "Paired" : "Not paired"}
                    </div>
                    <div className={device.isOnline ? "status-online" : "status-planned"}>
                      {device.isOnline ? "Online" : "Offline"}
                    </div>
                  </div>
                  <div>
                    <h3 style={{ margin: "0 0 4px" }}>{device.name}</h3>
                    <p className="muted" style={{ margin: 0 }}>
                      {device.manufacturer} {device.model} • Android {device.androidVersion}
                    </p>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gap: 6,
                      padding: 14,
                      borderRadius: 18,
                      background: "rgba(255,255,255,0.58)",
                      border: "1px solid var(--line)"
                    }}
                  >
                    <p className="muted" style={{ margin: 0 }}>
                      Paired {new Date(device.pairedAt).toLocaleString()}
                    </p>
                    <p className="muted" style={{ margin: 0 }}>
                      Last seen {new Date(device.lastSeenAt).toLocaleString()}
                    </p>
                    <p className="muted" style={{ margin: 0 }}>
                      Pairing status: {device.isPaired ? (device.isOnline ? "Paired and reachable" : "Paired but offline") : "Pairing removed"}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {device.capabilities.map((capability) => (
                      <span
                        className={
                          capability.status === "available"
                            ? "status-online"
                            : "status-planned"
                        }
                        key={`${device.id}-${capability.key}`}
                      >
                        {capability.label}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      className="button-secondary"
                      disabled={commandingDeviceId === device.id}
                      onClick={() => loadTelemetry(device.id)}
                      type="button"
                    >
                      {commandingDeviceId === device.id ? "Working..." : "Load device details"}
                    </button>
                    <button
                      className="button-secondary"
                      disabled={checkingDeviceId === device.id}
                      onClick={() => checkDeviceStatus(device.id)}
                      type="button"
                    >
                      {checkingDeviceId === device.id ? "Checking..." : "Check status"}
                    </button>
                    {device.isPaired ? (
                      <button
                        className="button-secondary"
                        disabled={activeDeviceId === device.id}
                        onClick={() => unpairDevice(device.id)}
                        type="button"
                      >
                        {activeDeviceId === device.id ? "Updating..." : "Unpair device"}
                      </button>
                    ) : null}
                    <button
                      className="button-secondary"
                      disabled={removingDeviceId === device.id}
                      onClick={() => removeDevice(device.id)}
                      type="button"
                    >
                      {removingDeviceId === device.id ? "Removing..." : "Remove device"}
                    </button>
                  </div>
                  {telemetry ? (
                    <div
                      style={{
                        display: "grid",
                        gap: 14,
                        padding: 14,
                        borderRadius: 18,
                        background: "rgba(255,255,255,0.58)",
                        border: "1px solid var(--line)"
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          flexWrap: "wrap",
                          alignItems: "center"
                        }}
                      >
                        <div>
                          <strong style={{ display: "block", marginBottom: 4 }}>
                            Live device details
                          </strong>
                          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                            Updated from the device background runtime
                          </p>
                        </div>
                        <button
                          className="button-secondary"
                          disabled={commandingDeviceId === device.id}
                          onClick={() =>
                            sendDeviceCommand(device.id, {
                              type: "device.refresh_info",
                              payload: { reason: "dashboard_refresh" }
                            })
                          }
                          type="button"
                        >
                          {commandingDeviceId === device.id ? "Sending..." : "Refresh info now"}
                        </button>
                        <button
                          className="button-secondary"
                          disabled={commandingDeviceId === device.id}
                          onClick={() =>
                            sendDeviceCommand(device.id, {
                              type: "device.get_location",
                              payload: { reason: "dashboard_get_location" }
                            })
                          }
                          type="button"
                        >
                          Get location
                        </button>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                          gap: 12
                        }}
                      >
                        <div
                          style={{
                            padding: 14,
                            borderRadius: 16,
                            background: "rgba(255,255,255,0.72)",
                            border: "1px solid var(--line)",
                            display: "grid",
                            gap: 6
                          }}
                        >
                          <span className="pill">Battery</span>
                          <strong style={{ fontSize: 24 }}>
                            {telemetry.latestBattery
                              ? `${telemetry.latestBattery.levelPercent}%`
                              : "--"}
                          </strong>
                          <p className="muted" style={{ margin: 0 }}>
                            {telemetry.latestBattery
                              ? telemetry.latestBattery.isCharging
                                ? "Charging"
                                : "Not charging"
                              : "No battery data yet"}
                          </p>
                          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                            {telemetry.latestBatteryAt
                              ? `Updated ${new Date(
                                  telemetry.latestBatteryAt
                                ).toLocaleString()}`
                              : "No update yet"}
                          </p>
                        </div>
                        <div
                          style={{
                            padding: 14,
                            borderRadius: 16,
                            background: "rgba(255,255,255,0.72)",
                            border: "1px solid var(--line)",
                            display: "grid",
                            gap: 6
                          }}
                        >
                          <span className="pill">Location</span>
                          <strong style={{ fontSize: 18 }}>
                            {showDisabledLocationState(telemetry)
                              ? "Location is disabled"
                              : hasLocationCoordinates(telemetry.latestLocation)
                                ? `${telemetry.latestLocation.latitude.toFixed(
                                    5
                                  )}, ${telemetry.latestLocation.longitude.toFixed(5)}`
                                : "Unavailable"}
                          </strong>
                          <p className="muted" style={{ margin: 0 }}>
                            {!telemetry.locationReportingEnabled
                              ? "Location reporting disabled. Showing the last known position."
                              : telemetry.latestLocation
                                ? telemetry.latestLocation.isEnabled === false
                                ? "Location disabled. Showing the last known position."
                                : telemetry.latestLocation.statusLabel === "last_known"
                                  ? "Current fix unavailable. Showing the last known position."
                                  : telemetry.latestLocation.accuracyMeters != null
                                    ? `Accuracy ${Math.round(
                                        telemetry.latestLocation.accuracyMeters
                                      )} m`
                                    : "Accuracy unavailable"
                                : "Tap Get location to fetch the latest position."}
                          </p>
                          {showDisabledLocationState(telemetry) ? (
                            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                              {hasLocationCoordinates(telemetry.latestLocation) &&
                              telemetry.latestLocationAt
                                ? `Last found ${telemetry.latestLocation.latitude.toFixed(
                                    5
                                  )}, ${telemetry.latestLocation.longitude.toFixed(
                                    5
                                  )} at ${new Date(
                                    telemetry.latestLocationAt
                                  ).toLocaleString()}`
                                : "No last found coordinates yet"}
                            </p>
                          ) : null}
                          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                            {telemetry.latestLocationAt
                              ? `Updated ${new Date(
                                  telemetry.latestLocationAt
                                ).toLocaleString()}`
                              : "No update yet"}
                          </p>
                        </div>
                        <div
                          style={{
                            padding: 14,
                            borderRadius: 16,
                            background: "rgba(255,255,255,0.72)",
                            border: "1px solid var(--line)",
                            display: "grid",
                            gap: 6
                          }}
                        >
                          <span className="pill">Hardware</span>
                          <strong style={{ fontSize: 18 }}>
                            {telemetry.latestInfo
                              ? `${formatBytes(telemetry.latestInfo.totalRamBytes)} RAM`
                              : "Unavailable"}
                          </strong>
                          <p className="muted" style={{ margin: 0 }}>
                            {telemetry.latestInfo
                              ? `${formatBytes(
                                  telemetry.latestInfo.availableStorageBytes
                                )} free of ${formatBytes(
                                  telemetry.latestInfo.totalStorageBytes
                                )}`
                              : "No hardware snapshot yet"}
                          </p>
                          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                            {telemetry.latestInfoAt
                              ? `Updated ${new Date(
                                  telemetry.latestInfoAt
                                ).toLocaleString()}`
                              : "No update yet"}
                          </p>
                        </div>
                      </div>
                      {telemetry.latestInfo ? (
                        <div
                          style={{
                            display: "grid",
                            gap: 10,
                            padding: 14,
                            borderRadius: 16,
                            background: "rgba(255,255,255,0.72)",
                            border: "1px solid var(--line)"
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 12,
                              flexWrap: "wrap",
                              alignItems: "center"
                            }}
                          >
                            <div>
                              <strong style={{ display: "block", marginBottom: 4 }}>
                                Device profile
                              </strong>
                              <p className="muted" style={{ margin: 0 }}>
                                Build {telemetry.latestInfo.buildId}
                              </p>
                            </div>
                            <div className="status-online">
                              {telemetry.latestInfo.batteryOptimizationIgnored
                                ? "Battery protected"
                                : "Battery optimization active"}
                            </div>
                          </div>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                              gap: 10
                            }}
                          >
                            <div>
                              <p className="muted" style={{ margin: "0 0 4px" }}>
                                Device name
                              </p>
                              <strong>{telemetry.latestInfo.deviceName}</strong>
                            </div>
                            <div>
                              <p className="muted" style={{ margin: "0 0 4px" }}>
                                OS
                              </p>
                              <strong>Android {telemetry.latestInfo.androidVersion}</strong>
                            </div>
                            <div>
                              <p className="muted" style={{ margin: "0 0 4px" }}>
                                Manufacturer
                              </p>
                              <strong>{telemetry.latestInfo.manufacturer}</strong>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              No devices registered yet. Pair one from the Android app to populate this
              workspace.
            </p>
          )}
        </section>

        <section
          className="glass-panel"
          style={{ borderRadius: "32px", padding: 28, display: "grid", gap: 18 }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center"
            }}
          >
            <div>
              <div className="pill" style={{ marginBottom: 8 }}>
                Call logs
              </div>
              <p className="muted" style={{ margin: 0 }}>
                Review synced device call history separately from notifications.
              </p>
            </div>
          </div>
          {devices.length ? (
            <div className="card-grid">
              {devices.map((device) => {
                const callLogsState = getCallLogsState(device.id);

                return (
                  <article
                    key={`call-logs-${device.id}`}
                    style={{
                      padding: 18,
                      borderRadius: 24,
                      background: "rgba(255,255,255,0.74)",
                      border: "1px solid var(--line)",
                      display: "grid",
                      gap: 12
                    }}
                  >
                    <div>
                      <h3 style={{ margin: "0 0 4px" }}>{device.name}</h3>
                      <p className="muted" style={{ margin: 0 }}>
                        {device.manufacturer} {device.model}
                      </p>
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button
                        className="button-secondary"
                        disabled={callLogsState.loading || commandingDeviceId === device.id}
                        onClick={() => refreshCallLogsFromDevice(device.id)}
                        type="button"
                      >
                        {commandingDeviceId === device.id
                          ? "Pulling..."
                          : callLogsState.loaded
                            ? "Refresh call logs"
                            : "Load call logs"}
                      </button>
                      <button
                        className="button-secondary"
                        disabled={clearingCallLogsDeviceId === device.id}
                        onClick={() => clearCallLogs(device.id)}
                        type="button"
                      >
                        {clearingCallLogsDeviceId === device.id
                          ? "Clearing..."
                          : "Clear call logs"}
                      </button>
                      <div className="pill">{callLogsState.items.length} shown</div>
                    </div>

                    {callLogsState.loaded || callLogsState.loading ? (
                      <>
                        {callLogsState.loading && !callLogsState.items.length ? (
                          <p className="muted" style={{ margin: 0 }}>
                            Loading call logs...
                          </p>
                        ) : null}

                        {!callLogsState.loading && !callLogsState.items.length ? (
                          <p className="muted" style={{ margin: 0 }}>
                            No call logs synced for this device yet.
                          </p>
                        ) : null}

                        <div style={{ display: "grid", gap: 10 }}>
                          {callLogsState.items.map((callLog) => (
                            <article
                              key={callLog.id}
                              style={{
                                padding: 12,
                                borderRadius: 14,
                                background: "rgba(255,255,255,0.72)",
                                border: "1px solid rgba(29,36,48,0.08)",
                                display: "grid",
                                gap: 6
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 10,
                                  flexWrap: "wrap",
                                  alignItems: "center"
                                }}
                              >
                                <strong>{callLog.contactName || callLog.phoneNumber}</strong>
                                <span className="muted" style={{ fontSize: 13 }}>
                                  {new Date(callLog.occurredAt).toLocaleString()}
                                </span>
                              </div>
                              <p className="muted" style={{ margin: 0 }}>
                                {formatCallType(callLog.callType)} • {callLog.phoneNumber}
                              </p>
                              <p className="muted" style={{ margin: 0 }}>
                                Duration {formatDuration(callLog.durationSeconds)}
                              </p>
                            </article>
                          ))}
                        </div>

                        {callLogsState.nextCursor ? (
                          <div style={{ display: "flex", justifyContent: "flex-start" }}>
                            <button
                              className="button-secondary"
                              disabled={callLogsState.loading}
                              onClick={() => loadCallLogs(device.id, { append: true })}
                              type="button"
                            >
                              {callLogsState.loading ? "Loading more..." : "Load more"}
                            </button>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <p className="muted" style={{ margin: 0 }}>
                        Load call logs when you want to review this device.
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Pair a device first to review synced call logs.
            </p>
          )}
        </section>

        <section
          className="glass-panel"
          style={{ borderRadius: "32px", padding: 28, display: "grid", gap: 18 }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center"
            }}
          >
            <div>
              <div className="pill" style={{ marginBottom: 8 }}>
                Notification center
              </div>
              <p className="muted" style={{ margin: 0 }}>
                Review captured notifications separately from device health.
              </p>
            </div>
          </div>
          {devices.length ? (
            <div className="card-grid">
              {devices.map((device) => {
                const notificationsState = getNotificationsState(device.id);
                const visibleItems = getVisibleNotifications(notificationsState.items);

                return (
                  <article
                    key={`notifications-${device.id}`}
                    style={{
                      padding: 18,
                      borderRadius: 24,
                      background: "rgba(255,255,255,0.74)",
                      border: "1px solid var(--line)",
                      display: "grid",
                      gap: 12
                    }}
                  >
                    <div>
                      <h3 style={{ margin: "0 0 4px" }}>{device.name}</h3>
                      <p className="muted" style={{ margin: 0 }}>
                        {device.manufacturer} {device.model}
                      </p>
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button
                        className="button-secondary"
                        disabled={
                          notificationsState.loading || commandingDeviceId === device.id
                        }
                        onClick={() => refreshNotificationsFromDevice(device.id)}
                        type="button"
                      >
                        {commandingDeviceId === device.id
                          ? "Pulling..."
                          : notificationsState.loaded
                            ? "Refresh notifications"
                            : "Load notifications"}
                      </button>
                      <button
                        className="button-secondary"
                        disabled={clearingNotificationsDeviceId === device.id}
                        onClick={() => clearNotifications(device.id)}
                        type="button"
                      >
                        {clearingNotificationsDeviceId === device.id
                          ? "Clearing..."
                          : "Clear notifications"}
                      </button>
                      <div className="pill">{visibleItems.length} shown</div>
                    </div>

                    {notificationsState.loaded || notificationsState.loading ? (
                      <>
                        <div style={{ display: "grid", gap: 10 }}>
                          <div
                            style={{
                              display: "flex",
                              gap: 10,
                              flexWrap: "wrap",
                              alignItems: "center"
                            }}
                          >
                            <input
                              onChange={(event) =>
                                updateNotificationDraft(device.id, event.target.value)
                              }
                              placeholder="Search notification title or text"
                              style={{
                                flex: "1 1 240px",
                                minWidth: 0,
                                padding: "12px 14px",
                                borderRadius: 14,
                                border: "1px solid var(--line)",
                                background: "rgba(255,255,255,0.82)",
                                font: "inherit",
                                color: "inherit"
                              }}
                              type="text"
                              value={notificationsState.draftQuery}
                            />
                            <button
                              className="button-secondary"
                              disabled={notificationsState.loading}
                              onClick={() => applyNotificationFilters(device.id)}
                              type="button"
                            >
                              Apply search
                            </button>
                          </div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              className="button-secondary"
                              disabled={notificationsState.loading}
                              onClick={() => applyNotificationFilters(device.id, null)}
                              style={{
                                opacity: notificationsState.appLabel ? 0.78 : 1
                              }}
                              type="button"
                            >
                              All apps
                            </button>
                            {notificationsState.appGroups.map((group) => (
                              <button
                                className="button-secondary"
                                disabled={notificationsState.loading}
                                key={`${device.id}-${group.appLabel}`}
                                onClick={() =>
                                  applyNotificationFilters(device.id, group.appLabel)
                                }
                                style={{
                                  opacity:
                                    notificationsState.appLabel === group.appLabel ? 1 : 0.78
                                }}
                                type="button"
                            >
                                {resolveNotificationAppName({
                                  appLabel: group.appLabel,
                                  packageName: group.appLabel
                                })} ({group.count})
                              </button>
                            ))}
                          </div>
                        </div>

                        {notificationsState.loading && !visibleItems.length ? (
                          <p className="muted" style={{ margin: 0 }}>
                            Loading notifications...
                          </p>
                        ) : null}

                        {!notificationsState.loading && !visibleItems.length ? (
                          <p className="muted" style={{ margin: 0 }}>
                            No notifications matched this device and filter set yet.
                          </p>
                        ) : null}

                        {Object.entries(groupNotificationsByApp(visibleItems)).map(
                          ([appLabel, items]) => (
                            <div
                              key={`${device.id}-${appLabel}`}
                              style={{
                                display: "grid",
                                gap: 10,
                                padding: 14,
                                borderRadius: 16,
                                background: "rgba(255,255,255,0.72)",
                                border: "1px solid var(--line)"
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 10,
                                  flexWrap: "wrap",
                                  alignItems: "center"
                                }}
                              >
                                <strong>{appLabel}</strong>
                                <span className="pill">{items.length} shown</span>
                              </div>
                              <div style={{ display: "grid", gap: 10 }}>
                                {items.map((notification) => (
                                  <article
                                    key={notification.id}
                                    style={{
                                      padding: 12,
                                      borderRadius: 14,
                                      background: "rgba(255,255,255,0.72)",
                                      border: "1px solid rgba(29,36,48,0.08)",
                                      display: "grid",
                                      gap: 6
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        gap: 10,
                                        flexWrap: "wrap",
                                        alignItems: "center"
                                      }}
                                    >
                                      <strong>{notification.title}</strong>
                                      <span className="muted" style={{ fontSize: 13 }}>
                                        {new Date(notification.postedAt).toLocaleString()}
                                      </span>
                                    </div>
                                    <p className="muted" style={{ margin: 0 }}>
                                      {notification.text}
                                    </p>
                                  </article>
                                ))}
                              </div>
                            </div>
                          )
                        )}

                        {notificationsState.nextCursor ? (
                          <div style={{ display: "flex", justifyContent: "flex-start" }}>
                            <button
                              className="button-secondary"
                              disabled={notificationsState.loading}
                              onClick={() => loadNotifications(device.id, { append: true })}
                              type="button"
                            >
                              {notificationsState.loading ? "Loading more..." : "Load more"}
                            </button>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <p className="muted" style={{ margin: 0 }}>
                        Load notifications when you want to review this device.
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Pair a device first to review captured notifications.
            </p>
          )}
        </section>

        <section
          className="glass-panel"
          style={{ borderRadius: "32px", padding: 28, display: "grid", gap: 18 }}
        >
          <div className="pill">Feature modules</div>
          <div className="card-grid">
            {FEATURE_MODULES.map((feature) => (
              <article
                key={feature}
                style={{
                  padding: 18,
                  borderRadius: 24,
                  background: "rgba(255,255,255,0.74)",
                  border: "1px solid var(--line)"
                }}
              >
                <div className="status-planned">Module shell</div>
                <h3>{feature}</h3>
                <p className="muted" style={{ marginBottom: 0 }}>
                  Reserved for an isolated backend module, Android capability adapter,
                  and dashboard interaction surface.
                </p>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

function shouldResolveLanIp(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "10.0.2.2"
  );
}

function decodePcm16Base64ToFloat32(value: string) {
  try {
    const binary = atob(value);
    const usableLength = binary.length - (binary.length % 2);
    if (usableLength <= 0) {
      return new Float32Array(0);
    }

    const byteBuffer = new Uint8Array(usableLength);
    for (let index = 0; index < usableLength; index += 1) {
      byteBuffer[index] = binary.charCodeAt(index);
    }

    const pcm16 = new Int16Array(byteBuffer.buffer);
    const pcm32 = new Float32Array(pcm16.length);
    for (let index = 0; index < pcm16.length; index += 1) {
      pcm32[index] = (pcm16[index] ?? 0) / 32768;
    }
    return pcm32;
  } catch {
    return new Float32Array(0);
  }
}

function formatBytes(value: number) {
  if (value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / 1024 ** index;
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatCallType(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDuration(totalSeconds: number) {
  if (totalSeconds <= 0) {
    return "0s";
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function showDisabledLocationState(telemetry: DeviceTelemetryState) {
  return (
    !telemetry.locationReportingEnabled ||
    telemetry.latestLocation?.isEnabled === false ||
    telemetry.latestLocation?.statusLabel === "disabled"
  );
}

function hasLocationCoordinates(
  location: DeviceTelemetryState["latestLocation"]
): location is NonNullable<DeviceTelemetryState["latestLocation"]> & {
  latitude: number;
  longitude: number;
} {
  return location?.latitude != null && location.longitude != null;
}

function groupNotificationsByApp(items: NotificationsPage["items"]) {
  return items.reduce<Record<string, NotificationsPage["items"]>>((groups, item) => {
    const appName = resolveNotificationAppName(item);
    const existingGroup = groups[appName] ?? [];
    groups[appName] = [...existingGroup, item];
    return groups;
  }, {});
}

function getVisibleNotifications(items: NotificationsPage["items"]) {
  const seenFingerprints = new Set<string>();

  return items.filter((item) => {
    if (isSummaryNotification(item)) {
      return false;
    }

    const fingerprint = [
      resolveNotificationAppName(item),
      normalizeNotificationPart(item.title),
      normalizeNotificationPart(item.text)
    ].join("|");

    if (seenFingerprints.has(fingerprint)) {
      return false;
    }

    seenFingerprints.add(fingerprint);
    return true;
  });
}

function isSummaryNotification(item: NotificationsPage["items"][number]) {
  return (
    normalizeNotificationPart(item.title) ===
      normalizeNotificationPart(resolveNotificationAppName(item)) &&
    /^\d+\s+messages?\s+from\s+\d+\s+chats?$/.test(
      normalizeNotificationPart(item.text)
    )
  );
}

function resolveNotificationAppName(input: {
  appLabel: string;
  packageName?: string;
}) {
  const appLabel = input.appLabel.trim();
  if (appLabel && !looksLikePackageName(appLabel)) {
    return appLabel;
  }

  return humanizePackageName(input.packageName || appLabel);
}

function looksLikePackageName(value: string) {
  return /^[a-z0-9_]+(\.[a-z0-9_]+)+$/i.test(value.trim());
}

function humanizePackageName(value: string) {
  const normalizedValue = value.trim().toLowerCase();
  const knownNames: Record<string, string> = {
    "com.whatsapp": "WhatsApp",
    "com.android.soundrecorder": "Sound Recorder",
    "com.google.android.gm": "Gmail",
    "com.instagram.android": "Instagram",
    "com.facebook.katana": "Facebook",
    "com.facebook.orca": "Messenger",
    "org.telegram.messenger": "Telegram",
    "com.google.android.youtube": "YouTube"
  };

  if (knownNames[normalizedValue]) {
    return knownNames[normalizedValue];
  }

  const genericSegments = new Set([
    "com",
    "org",
    "net",
    "android",
    "google",
    "app",
    "apps",
    "mobile"
  ]);
  const segments = normalizedValue.split(".").filter(Boolean);
  const candidate =
    [...segments].reverse().find((segment) => !genericSegments.has(segment)) ||
    segments.at(-1) ||
    normalizedValue;

  return candidate
    .replace(/whatsapp/g, "whats app")
    .replace(/soundrecorder/g, "sound recorder")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeNotificationPart(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\(\d+\s+messages?\)\s*:/gi, ":")
    .trim()
    .toLowerCase();
}
