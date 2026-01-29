import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

let OWNERS_FILE = '';
let configOwners: string[] = [];  // 从配置文件设置的主人
const pendingVerifications: Map<string, { code: string; expireTime: number }> = new Map();
let dynamicOwners: string[] = [];
let napCatLogger: ((msg: string) => void) | null = null;

export const setNapCatLogger = (logger: (msg: string) => void) => { napCatLogger = logger; };

// 从配置设置主人QQ列表
export function setConfigOwners(ownerQQs: string): void {
  if (!ownerQQs || ownerQQs.trim() === '') {
    configOwners = [];
    return;
  }
  configOwners = ownerQQs.split(',').map(qq => qq.trim()).filter(qq => qq.length > 0);
}

export function initOwnerDataDir(dataPath: string): void {
  if (!existsSync(dataPath)) mkdirSync(dataPath, { recursive: true });
  OWNERS_FILE = join(dataPath, 'owners.json');
  if (existsSync(OWNERS_FILE)) {
    try { dynamicOwners = JSON.parse(readFileSync(OWNERS_FILE, 'utf-8')) || []; } catch { dynamicOwners = []; }
  }
}

function saveOwners(): void {
  if (!OWNERS_FILE) return;
  const dir = dirname(OWNERS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(OWNERS_FILE, JSON.stringify(dynamicOwners, null, 2), 'utf-8');
}

function generateCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export const isOwner = (userId: string): boolean => {
  const uid = String(userId);
  return configOwners.includes(uid) || dynamicOwners.includes(uid);
};

export const getAllOwners = (): string[] => [...new Set([...configOwners, ...dynamicOwners])];

export function startOwnerVerification(userId: string): { success: boolean; code?: string; message: string } {
  const uid = String(userId);
  if (isOwner(uid)) return { success: false, message: '你已经是主人了喵～' };
  
  const code = generateCode();
  pendingVerifications.set(uid, { code, expireTime: Date.now() + 5 * 60 * 1000 });
  
  const log = `[AI Cat] 主人验证 | 用户: ${uid} | 验证码: ${code} | 有效期: 5分钟`;
  if (napCatLogger) napCatLogger(log);
  console.log(log);
  
  return { success: true, code, message: `验证码已生成并输出到 NapCat 日志中喵～\n请在5分钟内发送: xy 验证主人 <验证码>` };
}

export function verifyOwnerCode(userId: string, inputCode: string): { success: boolean; message: string } {
  const uid = String(userId);
  if (isOwner(uid)) return { success: false, message: '你已经是主人了喵～' };
  
  const pending = pendingVerifications.get(uid);
  if (!pending) return { success: false, message: '没有找到验证请求，请先发送「xy 设置主人」喵～' };
  if (Date.now() > pending.expireTime) { pendingVerifications.delete(uid); return { success: false, message: '验证码已过期喵～' }; }
  if (inputCode.trim() !== pending.code) return { success: false, message: '验证码错误喵～' };
  
  dynamicOwners.push(uid);
  saveOwners();
  pendingVerifications.delete(uid);
  return { success: true, message: `🎉 验证成功！你已成为主人喵～` };
}

export function removeOwner(operatorId: string, targetId: string): { success: boolean; message: string } {
  if (!configOwners.includes(String(operatorId))) return { success: false, message: '只有配置主人才能移除其他主人喵～' };
  const target = String(targetId);
  if (configOwners.includes(target)) return { success: false, message: '不能移除配置主人喵～请在插件配置中修改' };
  const index = dynamicOwners.indexOf(target);
  if (index === -1) return { success: false, message: '该用户不是主人喵～' };
  dynamicOwners.splice(index, 1);
  saveOwners();
  return { success: true, message: `已移除用户 ${target} 的主人权限喵～` };
}

export const listOwners = () => ({ default: [...configOwners], dynamic: [...dynamicOwners], total: getAllOwners().length });

export function cleanupExpiredVerifications(): void {
  const now = Date.now();
  for (const [userId, pending] of pendingVerifications) {
    if (now > pending.expireTime) pendingVerifications.delete(userId);
  }
}
