export function FileTransferProgress({ value }: { value: number }) {
  return (
    <div className="mt-2">
      <div className="h-1.5 overflow-hidden rounded-full bg-panel3">
        <div
          className="h-full rounded-full bg-gradient-to-r from-secondary to-primary transition-all"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <p className="mt-1 text-right text-[11px] text-muted">{Math.round(value)}%</p>
    </div>
  );
}
