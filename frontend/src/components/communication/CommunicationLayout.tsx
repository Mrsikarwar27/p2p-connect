import type { Ref, ReactNode } from "react";

export function CommunicationLayout({
  header,
  video,
  controls,
  side,
  focusMode = false,
  rootRef,
}: {
  header: ReactNode;
  video: ReactNode;
  controls: ReactNode;
  side: ReactNode;
  focusMode?: boolean;
  rootRef?: Ref<HTMLDivElement>;
}) {
  // Focus mode is pure CSS: header / controls / chat sidebar are hidden with
  // display:none (never unmounted — typed chat text and scroll survive), and
  // the video column stretches over the whole viewport.
  // Normal mode locks the page to the viewport (h-[100dvh] + overflow-hidden)
  // so message count can never grow the page — all chat scrolling stays
  // inside the messages list.
  return (
    <div
      ref={rootRef}
      className={
        focusMode
          ? "fixed inset-0 z-[80] flex h-[100dvh] flex-col overflow-hidden bg-black"
          : "flex h-[100dvh] flex-col overflow-hidden bg-surface"
      }
    >
      <div className={focusMode ? "hidden" : "shrink-0"}>{header}</div>
      <div
        className={
          focusMode
            ? "flex h-full w-full flex-1 flex-col p-0"
            : "mx-auto flex h-full min-h-0 w-full max-w-7xl flex-1 flex-col gap-4 p-3 sm:p-4 lg:flex-row"
        }
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {video}
          <div className={focusMode ? "hidden" : "shrink-0"}>{controls}</div>
        </div>
        <aside
          className={
            focusMode
              ? "hidden"
              : "flex min-h-[420px] w-full flex-col overflow-hidden rounded-2xl border border-border bg-panel lg:w-[380px] lg:shrink-0"
          }
        >
          {side}
        </aside>
      </div>
    </div>
  );
}
