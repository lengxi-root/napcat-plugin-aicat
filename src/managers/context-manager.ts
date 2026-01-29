import type { AIMessage, ContextInfo } from '../types';
import { CONTEXT_MAX_TURNS, CONTEXT_EXPIRE_SECONDS } from '../config';

interface ContextEntry { messages: AIMessage[]; timestamp: number; }

export class ContextManager {
  private contexts: Map<string, ContextEntry> = new Map();
  private maxTurns = CONTEXT_MAX_TURNS;
  private expireSeconds = CONTEXT_EXPIRE_SECONDS;

  private getKey(userId: string, groupId?: string): string {
    return groupId ? `g${groupId}_u${userId}` : `p${userId}`;
  }

  private isExpired(key: string): boolean {
    const entry = this.contexts.get(key);
    return !entry || Date.now() - entry.timestamp > this.expireSeconds * 1000;
  }

  getContext(userId: string, groupId?: string): AIMessage[] {
    const key = this.getKey(userId, groupId);
    if (this.isExpired(key)) { this.contexts.delete(key); return []; }
    return [...(this.contexts.get(key)?.messages || [])];
  }

  addMessage(userId: string, groupId: string | undefined, role: 'user' | 'assistant', content: string): void {
    const key = this.getKey(userId, groupId);
    if (this.isExpired(key)) this.contexts.set(key, { messages: [], timestamp: Date.now() });
    const entry = this.contexts.get(key)!;
    entry.messages.push({ role, content });
    if (entry.messages.length > this.maxTurns * 2) entry.messages = entry.messages.slice(-this.maxTurns * 2);
    entry.timestamp = Date.now();
  }

  clearContext(userId: string, groupId?: string): void {
    this.contexts.delete(this.getKey(userId, groupId));
  }

  getContextInfo(userId: string, groupId?: string): ContextInfo {
    const key = this.getKey(userId, groupId);
    const entry = this.contexts.get(key);
    const messages = entry?.messages || [];
    return { turns: Math.floor(messages.length / 2), messages: messages.length, expired: this.isExpired(key) };
  }
}

export const contextManager = new ContextManager();
