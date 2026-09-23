export function truncateMiddle(value: string, max = 28): string {
  if (value.length <= max) return value;
  const keep = Math.floor((max - 3) / 2);
  return `${value.slice(0, keep)}...${value.slice(value.length - keep)}`;
}
