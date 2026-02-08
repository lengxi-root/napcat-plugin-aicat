import type { AIMessage, ContextInfo } from '../types';
import { CONTEXT_MAX_TURNS, CONTEXT_EXPIRE_SECONDS } from '../config';

interface ContextEntry { messages: AIMessage[]; timestamp: number; }

const CLEANUP_INTERVAL = 120000; // 每2分钟清理过期上下文

export class ContextManager {
  private contexts = new Map<string, ContextEntry>();
  private maxTurns = CONTEXT_MAX_TURNS;
  private expireMs = CONTEXT_EXPIRE_SECONDS * 1000;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  private getKey (userId: string, groupId?: string): string {
    return groupId ? `g${groupId}_u${userId}` : `p${userId}`;
  }

  private isExpired (key: string): boolean {
    const entry = this.contexts.get(key);
    return !entry || Date.now() - entry.timestamp > this.expireMs;
  }

  getContext (userId: string, groupId?: string): AIMessage[] {
    const key = this.getKey(userId, groupId);
    if (this.isExpired(key)) { this.contexts.delete(key); return []; }
    return [...(this.contexts.get(key)?.messages || [])];
  }

  addMessage (userId: string, groupId: string | undefined, role: 'user' | 'assistant', content: string): void {
    const key = this.getKey(userId, groupId);
    if (this.isExpired(key)) this.contexts.set(key, { messages: [], timestamp: Date.now() });
    const entry = this.contexts.get(key)!;
    entry.messages.push({ role, content });
    const limit = this.maxTurns * 2;
    if (entry.messages.length > limit) entry.messages = entry.messages.slice(-limit);
    entry.timestamp = Date.now();
  }

  clearContext (userId: string, groupId?: string): void {
    this.contexts.delete(this.getKey(userId, groupId));
  }

  getContextInfo (userId: string, groupId?: string): ContextInfo {
    const key = this.getKey(userId, groupId);
    const entry = this.contexts.get(key);
    const messages = entry?.messages || [];
    return { turns: Math.floor(messages.length / 2), messages: messages.length, expired: this.isExpired(key) };
  }

  // 清理所有过期上下文，防止内存无限增长
  cleanup (): void {
    const now = Date.now();
    for (const [key, entry] of this.contexts) {
      if (now - entry.timestamp > this.expireMs) this.contexts.delete(key);
    }
  }

  startCleanup (): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL);
  }

  stopCleanup (): void {
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; }
    this.contexts.clear();
  }
}

export const contextManager = new ContextManager();
