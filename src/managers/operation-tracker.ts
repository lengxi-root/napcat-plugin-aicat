// 操作追踪器 - 通过监听 OneBot 通知事件确认操作结果
// 禁言、踢人等操作不返回结果，需要通过通知事件判断

export type OperationType = 'ban' | 'lift_ban' | 'kick' | 'set_admin' | 'unset_admin' | 'recall';

// 待确认的操作
export interface PendingOperation {
  id: string;
  type: OperationType;
  group_id: string;
  user_id: string;
  operator_id?: string;
  duration?: number;  // 禁言时长
  created_at: number;
  timeout: number;  // 超时时间（毫秒）
  resolve: (result: OperationResult) => void;
}

// 操作结果
export interface OperationResult {
  success: boolean;
  confirmed: boolean;  // 是否通过通知事件确认
  message: string;
  data?: unknown;
}

// 通知事件类型
export interface NoticeEvent {
  post_type: 'notice';
  notice_type: string;
  sub_type?: string;
  group_id?: number;
  user_id?: number;
  operator_id?: number;
  duration?: number;
  message_id?: number;
}

// 待确认的操作队列
const pendingOperations: Map<string, PendingOperation> = new Map();

// 生成操作ID
function generateOperationId (type: OperationType, groupId: string, userId: string): string {
  return `${type}_${groupId}_${userId}_${Date.now()}`;
}

// 添加待确认操作
export function addPendingOperation (
  type: OperationType,
  groupId: string,
  userId: string,
  options: { duration?: number; timeout?: number; operatorId?: string } = {}
): Promise<OperationResult> {
  const { duration, timeout = 5000, operatorId } = options;
  const id = generateOperationId(type, groupId, userId);

  return new Promise((resolve) => {
    const operation: PendingOperation = {
      id,
      type,
      group_id: groupId,
      user_id: userId,
      operator_id: operatorId,
      duration,
      created_at: Date.now(),
      timeout,
      resolve,
    };

    pendingOperations.set(id, operation);

    // 超时处理：假定成功（因为大多数情况下无返回=成功）
    setTimeout(() => {
      const op = pendingOperations.get(id);
      if (op) {
        pendingOperations.delete(id);
        op.resolve({
          success: true,
          confirmed: false,
          message: getSuccessMessage(type, userId, duration),
        });
      }
    }, timeout);
  });
}

// 处理通知事件
export function handleNoticeEvent (event: NoticeEvent): boolean {
  const { notice_type, sub_type, group_id, user_id, operator_id, duration } = event;

  if (!group_id || !user_id) return false;

  const groupIdStr = String(group_id);
  const userIdStr = String(user_id);

  // 遍历待确认操作，匹配通知
  for (const [id, op] of pendingOperations.entries()) {
    if (op.group_id !== groupIdStr || op.user_id !== userIdStr) continue;

    let matched = false;
    let isSuccess = true;

    // 禁言通知
    if (notice_type === 'group_ban') {
      if (op.type === 'ban' && sub_type === 'ban') {
        matched = true;
      } else if (op.type === 'lift_ban' && sub_type === 'lift_ban') {
        matched = true;
      }
    }

    // 群成员减少（踢人）
    if (notice_type === 'group_decrease' && op.type === 'kick') {
      if (sub_type === 'kick' || sub_type === 'kick_me') {
        matched = true;
      }
    }

    // 管理员变更
    if (notice_type === 'group_admin') {
      if (op.type === 'set_admin' && sub_type === 'set') {
        matched = true;
      } else if (op.type === 'unset_admin' && sub_type === 'unset') {
        matched = true;
      }
    }

    // 消息撤回
    if (notice_type === 'group_recall' && op.type === 'recall') {
      matched = true;
    }

    if (matched) {
      pendingOperations.delete(id);
      op.resolve({
        success: isSuccess,
        confirmed: true,
        message: getSuccessMessage(op.type, userIdStr, op.duration),
        data: { operator_id, duration },
      });
      return true;
    }
  }

  return false;
}

// 获取成功消息
function getSuccessMessage (type: OperationType, userId: string, duration?: number): string {
  switch (type) {
    case 'ban':
      return duration
        ? `已禁言用户 ${userId}，时长 ${Math.floor(duration / 60)}分钟`
        : `已禁言用户 ${userId}`;
    case 'lift_ban':
      return `已解除用户 ${userId} 的禁言`;
    case 'kick':
      return `已将用户 ${userId} 踢出群聊`;
    case 'set_admin':
      return `已设置用户 ${userId} 为管理员`;
    case 'unset_admin':
      return `已取消用户 ${userId} 的管理员`;
    case 'recall':
      return `已撤回消息`;
    default:
      return `操作成功`;
  }
}

// 清理过期操作
export function cleanupExpiredOperations (): void {
  const now = Date.now();
  for (const [id, op] of pendingOperations.entries()) {
    if (now - op.created_at > op.timeout * 2) {
      pendingOperations.delete(id);
    }
  }
}

// 获取待确认操作数量
export function getPendingCount (): number {
  return pendingOperations.size;
}
