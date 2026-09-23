import type { ReactNode } from "react";

export function ConnectionCard({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-xl rounded-2xl border border-border bg-panel p-6 shadow-2xl sm:p-8">
      {children}
    </div>
  );
}
