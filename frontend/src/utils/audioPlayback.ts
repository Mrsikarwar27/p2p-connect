/**
 * Single-playback policy for call audio.
 *
 * WebRTC echo is caused by the same audio track being played by more than one
 * element, or by a local element that is not actually muted. React props are
 * not enough: `srcObject` is (re)attached imperatively whenever a stream
 * wrapper changes, and the same MediaStreamTrack object can live inside more
 * than one MediaStream (new MediaStream(stream.getTracks()) shares tracks).
 *
 * This registry therefore works on TRACK IDs, app-wide:
 *   - a local stream is never audible, no matter when it is (re)attached;
 *   - each unique remote audio track id is audible through exactly ONE
 *     element (the highest-priority carrier);
 *   - every other element is muted with volume 0.
 *
 * It only touches srcObject / muted / volume of existing <video> elements.
 * No audio graph, no extra media elements, no libraries.
 */

export type PlaybackKind = "local" | "remote";

/** Higher priority wins the audio for a given audio track id. */
export const AUDIO_PRIORITY = {
  local: 0,
  remoteScreen: 10,
  remotePinned: 20,
  remoteCamera: 30,
} as const;

interface Attachment {
  kind: PlaybackKind;
  priority: number;
  audioTrackIds: Set<string>;
}

const attachments = new Map<HTMLVideoElement, Attachment>();

function silence(el: HTMLVideoElement): void {
  el.muted = true;
  el.volume = 0;
}

function makeAudible(el: HTMLVideoElement): void {
  el.muted = false;
  el.volume = 1;
}

function enforce(): void {
  // 1. Pick the single audible owner per remote audio track id.
  const owner = new Map<string, { el: HTMLVideoElement; priority: number }>();
  for (const [el, a] of attachments) {
    if (a.kind === "local") continue;
    for (const id of a.audioTrackIds) {
      const current = owner.get(id);
      if (!current || a.priority > current.priority) {
        owner.set(id, { el, priority: a.priority });
      }
    }
  }
  // 2. One element per track may be audible; everything else is silent.
  for (const [el, a] of attachments) {
    if (a.kind === "local" || a.audioTrackIds.size === 0) {
      silence(el);
      continue;
    }
    let ownsAll = true;
    for (const id of a.audioTrackIds) {
      if (owner.get(id)?.el !== el) {
        ownsAll = false;
        break;
      }
    }
    if (ownsAll) makeAudible(el);
    else silence(el);
  }
}

/** Attach a stream to an existing element and apply the playback policy. */
export function attachStreamToElement(
  el: HTMLVideoElement,
  stream: MediaStream | null,
  kind: PlaybackKind,
  priority: number,
): void {
  // Start silent on every (re)attach: a new srcObject must never be able to
  // make an element audible before the policy below has been applied.
  silence(el);
  el.srcObject = stream;
  if (!stream) {
    if (attachments.delete(el)) enforce();
    return;
  }
  attachments.set(el, {
    kind,
    priority,
    audioTrackIds: new Set(stream.getAudioTracks().map((t) => t.id)),
  });
  enforce();
}

/** Remove an element from the policy (unmount / stream detach). */
export function detachStreamFromElement(el: HTMLVideoElement): void {
  if (attachments.delete(el)) enforce();
}
