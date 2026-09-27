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
  toggleCamera: () => void;
  switchCamera: () => Promise<void>;
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
      const stream = await navigator.mediaDevices.getUserMedia(getConstraints(facingMode));
      streamRef.current = stream;
      setStream(stream);
      setStarted(true);
      setMicOn(true);
      setCameraOn(true);
      return stream;
    } catch (err) {
      console.warn("getUserMedia failed", err);
      const name = (err as DOMException | null)?.name;
      const detail =
        err instanceof Error && err.message ? `: ${err.message}` : "";
      switch (name) {
        case "NotFoundError":
        case "OverconstrainedError":
          console.info("No camera/microphone found. Chat and file sharing still available.");
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

  const toggleCamera = useCallback(() => {
    const s = streamRef.current;
    if (!s) return;
    const video = s.getVideoTracks();
    const next = !cameraOn;
    video.forEach((t) => {
      t.enabled = next;
    });
    setCameraOn(next);
  }, [cameraOn]);

  const switchCamera = useCallback(async () => {
    const s = streamRef.current;
    if (!s) return;

    const nextFacing = facingMode === "user" ? "environment" : "user";
    let newStream: MediaStream | null = null;
    let newVideoTrack: MediaStreamTrack | null = null;

    try {
      // First, try to get the new camera stream
      await enumerateVideoDevices();

      // Try with deviceId if we have multiple cameras
      let constraints = getConstraints(nextFacing);
      if (deviceIdsRef.current.length > 1) {
        // Find the next available camera device
        currentDeviceIndexRef.current = (currentDeviceIndexRef.current + 1) % deviceIdsRef.current.length;
        const nextDeviceId = deviceIdsRef.current[currentDeviceIndexRef.current];
        constraints = getConstraints(nextFacing, nextDeviceId);
      }

      newStream = await navigator.mediaDevices.getUserMedia(constraints);
      newVideoTrack = newStream.getVideoTracks()[0];

      if (!newVideoTrack) {
        throw new Error("No video track in new stream");
      }

      // Verify the new track is live
      if (newVideoTrack.readyState !== "live") {
        throw new Error("New video track not live");
      }

      // Replace the track in the existing stream (preserves audio)
      const oldVideoTracks = s.getVideoTracks();
      s.addTrack(newVideoTrack);

      // Update facing mode and stream reference
      setFacingMode(nextFacing);
      setStream(new MediaStream(s.getTracks()));

      // Now stop old video tracks AFTER successful replacement
      oldVideoTracks.forEach((t) => t.stop());

      // Clean up the temporary stream (audio tracks)
      newStream.getAudioTracks().forEach((t) => t.stop());

    } catch (err) {
      console.warn("Camera switch failed", err);
      setError("Could not switch camera. This device may not have a rear camera.");

      // Cleanup failed stream if any
      if (newStream) {
        newStream.getTracks().forEach((t) => t.stop());
      }

      // Keep current camera working - don't break existing stream
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