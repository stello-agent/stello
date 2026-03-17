// ─── 拆分保护机制 ───

import type { SessionTreeImpl } from './session-tree';
import type { SplitStrategy } from '../types/engine';

/** 拆分检查结果 */
export interface SplitCheckResult {
  canSplit: boolean;
  reason?: string;
}

/**
 * 拆分保护守卫
 *
 * 检查 Session 是否满足拆分条件：最少轮次 + 冷却期。
 * 防止过早或过于频繁的拆分。
 */
export class SplitGuard {
  private readonly minTurns: number;
  private readonly cooldownTurns: number;
  private lastSplitTurns = new Map<string, number>();

  constructor(
    private readonly sessions: SessionTreeImpl,
    strategy?: Partial<SplitStrategy>,
  ) {
    this.minTurns = strategy?.minTurns ?? 3;
    this.cooldownTurns = strategy?.cooldownTurns ?? 5;
  }

  /** 检查指定 Session 是否允许拆分 */
  async checkCanSplit(sessionId: string): Promise<SplitCheckResult> {
    const session = await this.sessions.get(sessionId);
    if (!session) return { canSplit: false, reason: 'Session 不存在' };

    if (session.turnCount < this.minTurns) {
      return { canSplit: false, reason: `对话轮次不足，至少需要 ${this.minTurns} 轮` };
    }

    const lastSplit = this.lastSplitTurns.get(sessionId);
    if (lastSplit !== undefined && session.turnCount - lastSplit < this.cooldownTurns) {
      return { canSplit: false, reason: `冷却期未满，距上次拆分需间隔 ${this.cooldownTurns} 轮` };
    }

    return { canSplit: true };
  }

  /** 记录一次拆分（由外部在 confirmSplit 成功后调用） */
  recordSplit(sessionId: string, turnCount: number): void {
    this.lastSplitTurns.set(sessionId, turnCount);
  }
}
