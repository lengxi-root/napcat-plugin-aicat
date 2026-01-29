// 插件全局状态管理
import type { ActionMap } from 'napcat-types/napcat-onebot/action/index';
import type { PluginLogger } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { NetworkAdapterConfig } from 'napcat-types/napcat-onebot/config/config';
import type { PluginConfig } from '../types';
import { DEFAULT_PLUGIN_CONFIG, DEFAULT_AI_CONFIG } from '../config';

class PluginState {
  private _logger: PluginLogger | null = null;
  private _actions: ActionMap | undefined;
  private _adapterName: string = '';
  private _networkConfig: NetworkAdapterConfig | null = null;
  private _config: PluginConfig = { ...DEFAULT_PLUGIN_CONFIG };
  private _currentModel: string = DEFAULT_AI_CONFIG.model;
  private _verificationCleanupInterval: ReturnType<typeof setInterval> | null = null;

  get logger() { return this._logger; }
  get actions() { return this._actions; }
  get adapterName() { return this._adapterName; }
  get networkConfig() { return this._networkConfig; }
  get config() { return this._config; }
  get currentModel() { return this._currentModel; }

  set logger(value: PluginLogger | null) { this._logger = value; }
  set actions(value: ActionMap | undefined) { this._actions = value; }
  set adapterName(value: string) { this._adapterName = value; }
  set networkConfig(value: NetworkAdapterConfig | null) { this._networkConfig = value; }
  set config(value: PluginConfig) { this._config = value; }
  set currentModel(value: string) { this._currentModel = value; }

  updateConfig(partial: Partial<PluginConfig>): void {
    this._config = { ...this._config, ...partial };
  }

  setVerificationCleanupInterval(interval: ReturnType<typeof setInterval>): void {
    this._verificationCleanupInterval = interval;
  }

  clearVerificationCleanupInterval(): void {
    if (this._verificationCleanupInterval) {
      clearInterval(this._verificationCleanupInterval);
      this._verificationCleanupInterval = null;
    }
  }

  log(level: 'info' | 'warn' | 'error', message: string, ...args: unknown[]): void {
    if (!this._logger) return;
    const prefix = '[AI Cat]';
    switch (level) {
      case 'info': this._logger.info(`${prefix} ${message}`, ...args); break;
      case 'warn': this._logger.warn(`${prefix} ${message}`, ...args); break;
      case 'error': this._logger.error(`${prefix} ${message}`, ...args); break;
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (!this._logger || !this._config.debug) return;
    this._logger.info(`[AI Cat] [DEBUG] ${message}`, ...args);
  }
}

export const pluginState = new PluginState();
