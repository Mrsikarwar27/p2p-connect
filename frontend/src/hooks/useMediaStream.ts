import { useCallback, useEffect, useRef, useState } from "react";

export interface MediaState {
  stream: MediaStream | null;
  micOn: boolean;
  cameraOn: boolean;
  error: string | null;
  started: boolean;
  facingMode: "user" | "environment";
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
      return videoDevices;
    } catch {
      deviceIdsRef.current = [];
      return [];
    }
  }, []);

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

  const switchCamera = useCallback(async () => {
    const s = streamRef.current;
    if (!s) return undefined;

    const nextFacing = facingMode === "user" ? "environment" : "user";
    let newStream: MediaStream | null = null;
    let newVideoTrack: MediaStreamTrack | null = null;

    try {
      await enumerateVideoDevices();

      // Request VIDEO ONLY (no audio)
      let videoConstraints: boolean | MediaTrackConstraints = { facingMode: { ideal: nextFacing } };
      if (deviceIdsRef.current.length > 1) {
        currentDeviceIndexRef.current = (currentDeviceIndexRef.current + 1) % deviceIdsRef.current.length;
        videoConstraints = { deviceId: { exact: deviceIdsRef.current[currentDeviceIndexRef.current] }, facingMode: undefined };
      }
      newStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
      newVideoTrack = newStream.getVideoTracks()[0];

      if (!newVideoTrack) {
        throw new Error("No video track in new stream");
      }
      if (newVideoTrack.readyState !== "live") {
        throw new Error("New video track not live");
      }

      const oldVideoTracks = s.getVideoTracks();

      // Stop old tracks FIRST, then add new one (so stream never has two live video tracks)
      oldVideoTracks.forEach((t) => t.stop());

      s.addTrack(newVideoTrack);
      streamRef.current = s; // same stream object, updated tracks
      setFacingMode(nextFacing);
      setStream(new MediaStream(s.getTracks()));
      setCameraOn(true);

      // Clean up temporary stream (audio tracks should be none, but guard anyway)
      newStream.getAudioTracks().forEach((t) => t.stop());
      newStream.getVideoTracks().forEach((t) => {
        if (t !== newVideoTrack) t.stop();
      });

      return newVideoTrack;
    } catch (err) {
      console.warn("Camera switch failed", err);
      setError("Could not switch camera. This device may not have a rear camera.");
      if (newStream) {
        newStream.getTracks().forEach((t) => t.stop());
      }
      return undefined;
    }
  }, [facingMode, enumerateVideoDevices]);

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

  return { stream, micOn, cameraOn, error, started, facingMode, start, stop, toggleMic, toggleCamera, switchCamera };
}