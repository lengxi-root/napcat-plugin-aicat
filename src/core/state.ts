// 插件全局状态管理
import type { ActionMap } from 'napcat-types/napcat-onebot/action/index';
import type { PluginLogger } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { NetworkAdapterConfig } from 'napcat-types/napcat-onebot/config/config';
import type { PluginConfig } from '../types';
import { DEFAULT_PLUGIN_CONFIG, DEFAULT_AI_CONFIG } from '../config';

class PluginState {
  logger: PluginLogger | null = null;
  actions: ActionMap | undefined;
  adapterName: string = '';
  networkConfig: NetworkAdapterConfig | null = null;
  config: PluginConfig = { ...DEFAULT_PLUGIN_CONFIG };
  currentModel: string = DEFAULT_AI_CONFIG.model;
  private _cleanupInterval: ReturnType<typeof setInterval> | null = null;

  setVerificationCleanupInterval (interval: ReturnType<typeof setInterval>): void { this._cleanupInterval = interval; }
  clearVerificationCleanupInterval (): void { if (this._cleanupInterval) { clearInterval(this._cleanupInterval); this._cleanupInterval = null; } }

  log (level: 'info' | 'warn' | 'error', msg: string, ...args: unknown[]): void {
    if (!this.logger) return;
    this.logger[level](`[AI Cat] ${msg}`, ...args);
  }

  debug (msg: string, ...args: unknown[]): void {
    if (this.logger && this.config.debug) this.logger.info(`[AI Cat] [DEBUG] ${msg}`, ...args);
  }
}

export const pluginState = new PluginState();
