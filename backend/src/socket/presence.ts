import type { SocketUser } from "../types/auth.js";

interface PresenceEntry {
  name: string;
  username: string;
  socketIds: Set<string>;
}

export interface OnlineUser {
  userId: string;
  name: string;
  username: string;
  busy: boolean;
}

/**
 * In-memory presence only. Nothing here is written to MongoDB.
 * Multiple authenticated sockets of the same account count as ONE user.
 */
export class PresenceManager {
  private users = new Map<string, PresenceEntry>();

  add(user: SocketUser, socketId: string): void {
    const entry = this.users.get(user.id);
    if (entry) {
      entry.socketIds.add(socketId);
      entry.name = user.name;
      entry.username = user.username;
      return;
    }
    this.users.set(user.id, {
      name: user.name,
      username: user.username,
      socketIds: new Set([socketId]),
    });
  }

  /** Returns the account and whether it still has any live socket. */
  remove(socketId: string): { userId: string; online: boolean } | null {
    for (const [userId, entry] of this.users) {
      if (!entry.socketIds.has(socketId)) continue;
      entry.socketIds.delete(socketId);
      if (entry.socketIds.size === 0) this.users.delete(userId);
      return { userId, online: entry.socketIds.size > 0 };
    }
    return null;
  }

  get(userId: string): PresenceEntry | undefined {
    return this.users.get(userId);
  }

  isOnline(userId: string): boolean {
    return this.users.has(userId);
  }

  socketIds(userId: string): string[] {
    return [...(this.users.get(userId)?.socketIds ?? [])];
  }

  /** Every online account except the one asking, with live busy state. */
  list(excludeUserId: string, isBusy: (userId: string) => boolean): OnlineUser[] {
    const out: OnlineUser[] = [];
    for (const [userId, entry] of this.users) {
      if (userId === excludeUserId) continue;
      out.push({
        userId,
        name: entry.name,
        username: entry.username,
        busy: isBusy(userId),
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }
}
