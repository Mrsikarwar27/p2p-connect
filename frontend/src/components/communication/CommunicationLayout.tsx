import type { ReactNode } from "react";

export function CommunicationLayout({
  header,
  video,
  controls,
  side,
}: {
  header: ReactNode;
  video: ReactNode;
  controls: ReactNode;
  side: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      {header}
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-3 sm:p-4 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col">
          {video}
          {controls}
        </div>
        <aside className="flex min-h-[420px] w-full flex-col overflow-hidden rounded-2xl border border-border bg-panel lg:w-[380px] lg:shrink-0">
          {side}
        </aside>
      </div>
    </div>
  );
}
