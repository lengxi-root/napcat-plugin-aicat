// 插件全局状态管理
import type { ActionMap } from 'napcat-types/napcat-onebot/action/index';
import type { PluginLogger } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { NetworkAdapterConfig } from 'napcat-types/napcat-onebot/config/config';
import type { PluginConfig } from '../types';
import { DEFAULT_PLUGIN_CONFIG } from '../config';

class PluginState {
  logger: PluginLogger | null = null;
  actions: ActionMap | undefined;
  adapterName = '';
  networkConfig: NetworkAdapterConfig | null = null;
  config: PluginConfig = { ...DEFAULT_PLUGIN_CONFIG };
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  // 定时器管理
  setVerificationCleanupInterval(interval: ReturnType<typeof setInterval>): void {
    this.cleanupInterval = interval;
  }

  clearVerificationCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  // 日志输出
  log(level: 'info' | 'warn' | 'error', msg: string, ...args: unknown[]): void {
    this.logger?.[level](`[AI Cat] ${msg}`, ...args);
  }

  debug(msg: string, ...args: unknown[]): void {
    if (this.config.debug) this.logger?.info(`[AI Cat] [DEBUG] ${msg}`, ...args);
  }
}

export const pluginState = new PluginState();
