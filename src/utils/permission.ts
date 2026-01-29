// 权限检查工具函数
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { UserPermission } from '../types';
import { isOwner } from '../managers/owner-manager';
import { pluginState } from '../core/state';

// 检查用户权限
export async function checkUserPermission(
  userId: string,
  groupId: string | undefined,
  ctx: NapCatPluginContext
): Promise<UserPermission> {
  // 主人拥有最高权限
  if (isOwner(userId)) {
    return { is_admin: true, is_owner: true, role: 'owner' };
  }

  // 私聊没有管理员权限
  if (!groupId || !ctx.actions) {
    return { is_admin: false, is_owner: false, role: 'member' };
  }

  // 查询群成员信息获取权限
  try {
    const result = await ctx.actions.call(
      'get_group_member_info',
      { group_id: groupId, user_id: userId } as never,
      ctx.adapterName,
      ctx.pluginManager.config
    );
    const role = (result as { role?: string })?.role || 'member';

    return {
      is_admin: role === 'admin' || role === 'owner',
      is_owner: role === 'owner',
      role: role as 'owner' | 'admin' | 'member',
    };
  } catch (error) {
    pluginState.log('error', '获取用户权限失败:', error);
    return { is_admin: false, is_owner: false, role: 'member' };
  }
}

/**
 * 构建权限信息字符串
 * @param userPerm 用户权限
 * @param userIsOwner 是否为主人
 */
export function buildPermissionInfo(
  userPerm: UserPermission,
  userIsOwner: boolean
): string {
  if (userIsOwner) {
    return '主人（最高权限），可执行所有操作';
  }

  if (userPerm.is_admin) {
    return '管理员，可执行管理操作';
  }

  return '普通成员，无管理权限。若请求管理操作，直接告知：你不是管理员，无法执行此操作喵';
}
