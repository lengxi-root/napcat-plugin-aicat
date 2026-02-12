// 插件全局状态管理
import type { ActionMap } from 'napcat-types/napcat-onebot/action/index';
import type { PluginLogger } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { NetworkAdapterConfig } from 'napcat-types/napcat-onebot/config/config';
import type { PluginConfig } from '../types';
import { DEFAULT_PLUGIN_CONFIG } from '../config';
import fs from 'fs';
import path from 'path';

class PluginState {
  logger: PluginLogger | null = null;
  actions: ActionMap | undefined;
  adapterName = '';
  networkConfig: NetworkAdapterConfig | null = null;
  config: PluginConfig = { ...DEFAULT_PLUGIN_CONFIG };
  configPath = '';
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  // 定时器管理
  setVerificationCleanupInterval (interval: ReturnType<typeof setInterval>): void {
    this.cleanupInterval = interval;
  }

  clearVerificationCleanupInterval (): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  // 日志输出
  log (level: 'info' | 'warn' | 'error', msg: string, ...args: unknown[]): void {
    this.logger?.[level](`[AI Cat] ${msg}`, ...args);
  }

  debug (msg: string, ...args: unknown[]): void {
    if (this.config.debug) this.logger?.info(`[AI Cat] [DEBUG] ${msg}`, ...args);
  }

  // 群AI开关管理
  isGroupAIDisabled (groupId: string): boolean {
    return (this.config.disabledGroups || []).includes(groupId);
  }

  setGroupAI (groupId: string, enabled: boolean): void {
    if (!this.config.disabledGroups) this.config.disabledGroups = [];
    const idx = this.config.disabledGroups.indexOf(groupId);
    if (enabled && idx !== -1) {
      this.config.disabledGroups.splice(idx, 1);
    } else if (!enabled && idx === -1) {
      this.config.disabledGroups.push(groupId);
    }
    this.saveConfig();
  }

  // 持久化配置
  saveConfig (): void {
    if (!this.configPath) return;
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (e) {
      this.log('error', `保存配置失败: ${e}`);
    }
  }
}

export const pluginState = new PluginState();
