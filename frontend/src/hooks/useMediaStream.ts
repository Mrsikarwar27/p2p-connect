import { useCallback, useEffect, useRef, useState } from "react";

export interface MediaState {
  stream: MediaStream | null;
  micOn: boolean;
  cameraOn: boolean;
  error: string | null;
  started: boolean;
  facingMode: "user" | "environment";
  hasMultipleCameras: boolean;
}

export function useMediaStream(): MediaState & {
  start: () => Promise<MediaStream | null>;
  stop: () => void;
  toggleMic: () => void;
  toggleCamera: () => void | Promise<void>;
  switchCamera: () => Promise<MediaStreamTrack | undefined>;
} {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [videoInputCount, setVideoInputCount] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const deviceIdsRef = useRef<string[]>([]);
  const currentDeviceIndexRef = useRef(0);
  const acquiringRef = useRef(false);

  const getConstraints = (facing: "user" | "environment", deviceId?: string) => ({
    video: {
      facingMode: deviceId ? undefined : { ideal: facing },
      deviceId: deviceId ? { exact: deviceId } : undefined,
    },
    audio: true,
  });

  const enumerateVideoDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices
        .filter((d) => d.kind === "videoinput")
        .map((d) => d.deviceId);
      deviceIdsRef.current = videoDevices;
      setVideoInputCount(videoDevices.length);
      return videoDevices;
    } catch {
      deviceIdsRef.current = [];
      setVideoInputCount(0);
      return [];
    }
  }, []);

  // Camera availability can change (external webcam plugged/unplugged),
  // so re-check the real device list whenever devices change.
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const update = () => {
      void enumerateVideoDevices();
    };
    update();
    navigator.mediaDevices.addEventListener?.("devicechange", update);
    return () => {
      navigator.mediaDevices.removeEventListener?.("devicechange", update);
    };
  }, [enumerateVideoDevices]);

  const start = useCallback(async () => {
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException(
          "Media devices API not available in this browser or context.",
          "NotSupportedError",
        );
      }
      if (streamRef.current) {
        return streamRef.current;
      }
      await enumerateVideoDevices();

      // Fallback chain: audio+video → video-only → audio-only
      let attempts: { video: boolean; audio: boolean; label: string }[] = [
        { video: true, audio: true, label: "audio+video" },
        { video: true, audio: false, label: "video-only" },
        { video: false, audio: true, label: "audio-only" },
      ];

      let lastErr: unknown = null;
      for (const attempt of attempts) {
        try {
          const videoPart = attempt.video ? getConstraints(facingMode) : false;
          const constraints: MediaStreamConstraints = videoPart ? { ...videoPart, audio: attempt.audio } : { video: false, audio: attempt.audio };
          const s = await navigator.mediaDevices.getUserMedia(constraints);
          streamRef.current = s;
          setStream(s);
          setStarted(true);
          const audioTracks = s.getAudioTracks();
          const videoTracks = s.getVideoTracks();
          setMicOn(audioTracks.some((t) => t.readyState === "live" && t.enabled));
          setCameraOn(videoTracks.some((t) => t.readyState === "live" && t.enabled));
          if (attempt.label !== "audio+video") {
            setError(
              attempt.label === "video-only"
                ? "Microphone not available. Connected with camera only."
                : "Camera not available. Connected with microphone only.",
            );
          }
          return s;
        } catch (err) {
          lastErr = err;
          const errName = (err as DOMException | null)?.name;
          // For NotFoundError / OverconstrainedError on audio+video, continue to next attempt
          if (attempt.label === "audio+video" && (errName === "NotFoundError" || errName === "OverconstrainedError")) {
            continue;
          }
          // For video-only, if video fails but audio works in audio-only attempt, continue
          if (attempt.label !== "audio-only") {
            continue;
          }
          // Final attempt failed — throw to outer catch
          throw err;
        }
      }
      // If we exhaust attempts without throwing, treat as failure
      throw lastErr;
    } catch (err) {
      console.warn("getUserMedia failed", err);
      const name = (err as DOMException | null)?.name;
      const detail = err instanceof Error && err.message ? `: ${err.message}` : "";
      switch (name) {
        case "NotFoundError":
        case "OverconstrainedError":
          setError(
            "No camera or microphone found. Chat and file sharing still available.",
          );
          break;
        case "NotAllowedError":
        case "PermissionDeniedError":
          setError(
            "Camera or microphone permission was denied. Please allow access in your browser settings. You can still use chat and file sharing.",
          );
          break;
        case "NotReadableError":
        case "AbortError":
          try {
            const audioStream = await navigator.mediaDevices.getUserMedia({
              video: false,
              audio: true,
            });
            streamRef.current = audioStream;
            setStream(audioStream);
            setStarted(true);
            setMicOn(true);
            setCameraOn(false);
            setError(
              "Camera is being used by another application/tab. Connected with microphone only.",
            );
            return audioStream;
          } catch {
            setError(
              "Camera or microphone exists but is currently unavailable or being used by another application. Please close other apps using it and try again. You can still use chat and file sharing.",
            );
          }
          break;
        case "SecurityError":
          setError(
            "Browser/security policy prevented access to camera or microphone. Please use HTTPS or localhost and check site permissions. You can still use chat and file sharing.",
          );
          break;
        default:
          setError(
            `Could not start camera or microphone${detail}. You can still use chat and file sharing.`,
          );
          break;
      }
      setStarted(false);
      return null;
    }
  }, [facingMode, enumerateVideoDevices]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* noop */
      }
    });
    streamRef.current = null;
    setStream(null);
    setStarted(false);
  }, []);

  const toggleMic = useCallback(() => {
    const s = streamRef.current;
    if (!s) return;
    const audio = s.getAudioTracks();
    const next = !micOn;
    audio.forEach((t) => {
      t.enabled = next;
    });
    setMicOn(next);
  }, [micOn]);

  const toggleCamera = useCallback(async (): Promise<void> => {
    const s = streamRef.current;
    const videoTracks = s?.getVideoTracks() ?? [];
    if (videoTracks.length > 0) {
      const next = !cameraOn;
      videoTracks.forEach((t) => {
        t.enabled = next;
      });
      setCameraOn(next);
      return;
    }
    // No video track exists (permission was denied at start, audio-only
    // fallback, or no camera found) — if we show "on", just sync state down.
    if (cameraOn) {
      setCameraOn(false);
      return;
    }
    // Turning on with no track: acquire the camera on demand.
    if (acquiringRef.current) return;
    acquiringRef.current = true;
    try {
      const videoOnly = getConstraints(facingMode).video;
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: videoOnly,
        audio: false,
      });
      const track = newStream.getVideoTracks()[0];
      if (!track) throw new Error("No video track returned");
      if (s) {
        s.addTrack(track);
        setStream(new MediaStream(s.getTracks()));
      } else {
        streamRef.current = newStream;
        setStream(newStream);
        setStarted(true);
      }
      setCameraOn(true);
      setError(null);
    } catch (err) {
      const name = (err as DOMException | null)?.name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError(
          "Camera permission is blocked. Allow camera for this site in your browser's address-bar settings, then press the camera button again.",
        );
      } else {
        setError("Could not turn on the camera. It may be in use by another app or unavailable.");
      }
    } finally {
      acquiringRef.current = false;
    }
  }, [cameraOn, facingMode]);

  const switchCamera = useCallback(async (): Promise<MediaStreamTrack | undefined> => {
    const s = streamRef.current;
    if (!s) return undefined;

    // Capability check FIRST: count the real videoinput devices. With fewer
    // than 2 cameras the switch is a complete no-op — getUserMedia is never
    // called and the running track/stream are left untouched.
    const devices = await enumerateVideoDevices();
    if (devices.length < 2) {
      setError("Only one camera available on this device.");
      return undefined;
    }

    // Cycle through the ACTUAL deviceIds from enumerateDevices — no
    // facingMode guesses.
    currentDeviceIndexRef.current = (currentDeviceIndexRef.current + 1) % devices.length;
    const nextDeviceId = devices[currentDeviceIndexRef.current];

    let newStream: MediaStream | null = null;
    try {
      newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: nextDeviceId } },
        audio: false,
      });
      const newVideoTrack = newStream.getVideoTracks()[0];
      if (!newVideoTrack || newVideoTrack.readyState !== "live") {
        throw new Error("New camera track not live");
      }

      // SAFE ORDER — new track first, old track last. Everything that can
      // fail has already succeeded above; only now is the old camera touched.
      const oldVideoTracks = s.getVideoTracks();
      s.addTrack(newVideoTrack);
      oldVideoTracks.forEach((t) => s.removeTrack(t));
      streamRef.current = s;
      setFacingMode((f) => (f === "user" ? "environment" : "user"));
      setStream(new MediaStream(s.getTracks()));
      setCameraOn(true);
      setError(null);
      // Stop the old camera only after the new one is live in the stream.
      oldVideoTracks.forEach((t) => t.stop());
      return newVideoTrack;
    } catch (err) {
      // Failed switch must be invisible in the video: the old camera keeps
      // running completely untouched.
      console.warn("Camera switch failed", err);
      if (newStream) {
        newStream.getTracks().forEach((t) => t.stop());
      }
      setError("Camera switch failed — other camera not available.");
      return undefined;
    }
  }, [enumerateVideoDevices]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* noop */
        }
      });
    };
  }, []);

  return { stream, micOn, cameraOn, error, started, facingMode, hasMultipleCameras: videoInputCount >= 2, start, stop, toggleMic, toggleCamera, switchCamera };
}