// ─── 确认协议管理器 ───

import type { ConfirmProtocol, SplitProposal, UpdateProposal } from '../types/lifecycle';
import type { SessionMeta } from '../types/session';
import type { CoreMemory } from '../memory/core-memory';
import type { LifecycleManager } from '../lifecycle/lifecycle-manager';

/**
 * 确认协议管理器
 *
 * 实现 ConfirmProtocol 接口，处理拆分建议和 L1 更新建议的确认/拒绝。
 * 框架只管事件 + API，不提供 UI 组件。
 */
export class ConfirmManager implements ConfirmProtocol {
  constructor(
    private readonly coreMemory: CoreMemory,
    private readonly lifecycle: LifecycleManager,
  ) {}

  /** 确认拆分 → 创建子 Session + scope.md + 更新父 index.md */
  async confirmSplit(proposal: SplitProposal): Promise<SessionMeta> {
    return this.lifecycle.prepareChildSpawn({
      parentId: proposal.parentId,
      label: proposal.suggestedLabel,
      scope: proposal.suggestedScope,
    });
  }

  /** 拒绝拆分 → 不创建，继续当前 Session */
  async dismissSplit(_proposal: SplitProposal): Promise<void> {
    // v0.1 空实现：不做额外操作
  }

  /** 确认 L1 更新 → 跳过 requireConfirm 直接写入 */
  async confirmUpdate(proposal: UpdateProposal): Promise<void> {
    await this.coreMemory.confirmWrite(proposal.path, proposal.newValue);
  }

  /** 拒绝 L1 更新 → 不写入 */
  async dismissUpdate(_proposal: UpdateProposal): Promise<void> {
    // v0.1 空实现：不做额外操作
  }
}
