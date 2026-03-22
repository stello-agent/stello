import { describe, expect, it, vi } from 'vitest';
import { Scheduler } from '../scheduler';

describe('Scheduler', () => {
  it('达到 everyNTurns 阈值时触发 consolidate', async () => {
    const scheduler = new Scheduler({
      consolidation: { trigger: 'everyNTurns', everyNTurns: 2 },
    });
    const session = {
      id: 's1',
      turnCount: 2,
      consolidate: vi.fn().mockResolvedValue(undefined),
    };

    const result = await scheduler.afterTurn(session);

    expect(session.consolidate).toHaveBeenCalledTimes(1);
    expect(result.consolidated).toBe(true);
  });

  it('未达到阈值时不触发 consolidate', async () => {
    const scheduler = new Scheduler({
      consolidation: { trigger: 'everyNTurns', everyNTurns: 3 },
    });
    const session = {
      id: 's1',
      turnCount: 2,
      consolidate: vi.fn(),
    };

    const result = await scheduler.afterTurn(session);

    expect(session.consolidate).not.toHaveBeenCalled();
    expect(result.consolidated).toBe(false);
  });

  it('consolidate 成功后按 afterConsolidate 触发 integrate', async () => {
    const scheduler = new Scheduler({
      consolidation: { trigger: 'everyNTurns', everyNTurns: 2 },
      integration: { trigger: 'afterConsolidate' },
    });
    const session = {
      id: 's1',
      turnCount: 2,
      consolidate: vi.fn().mockResolvedValue(undefined),
    };
    const mainSession = {
      integrate: vi.fn().mockResolvedValue(undefined),
    };

    const result = await scheduler.afterTurn(session, mainSession);

    expect(session.consolidate).toHaveBeenCalledTimes(1);
    expect(mainSession.integrate).toHaveBeenCalledTimes(1);
    expect(result.integrated).toBe(true);
  });

  it('consolidate 失败不阻断主路径，并返回错误信息', async () => {
    const scheduler = new Scheduler({
      consolidation: { trigger: 'onSwitch' },
      integration: { trigger: 'afterConsolidate' },
    });
    const session = {
      id: 's1',
      turnCount: 2,
      consolidate: vi.fn().mockRejectedValue(new Error('summary failed')),
    };
    const mainSession = {
      integrate: vi.fn(),
    };

    const result = await scheduler.onSessionSwitch(session, mainSession);

    expect(result.consolidated).toBe(false);
    expect(result.integrated).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.stage).toBe('consolidate');
    expect(mainSession.integrate).not.toHaveBeenCalled();
  });

  it('独立的 integration everyNTurns 也能触发 integrate', async () => {
    const scheduler = new Scheduler({
      integration: { trigger: 'everyNTurns', everyNTurns: 4 },
    });
    const session = {
      id: 's1',
      turnCount: 4,
      consolidate: vi.fn(),
    };
    const mainSession = {
      integrate: vi.fn().mockResolvedValue(undefined),
    };

    const result = await scheduler.afterTurn(session, mainSession);

    expect(mainSession.integrate).toHaveBeenCalledTimes(1);
    expect(result.integrated).toBe(true);
  });

  it('onLeave 策略会在 leave 时触发 consolidate 和 integrate', async () => {
    const scheduler = new Scheduler({
      consolidation: { trigger: 'onLeave' },
      integration: { trigger: 'onLeave' },
    });
    const session = {
      id: 's1',
      turnCount: 4,
      consolidate: vi.fn().mockResolvedValue(undefined),
    };
    const mainSession = {
      integrate: vi.fn().mockResolvedValue(undefined),
    };

    const result = await scheduler.onSessionLeave(session, mainSession);

    expect(session.consolidate).toHaveBeenCalledTimes(1);
    expect(mainSession.integrate).toHaveBeenCalledTimes(1);
    expect(result.consolidated).toBe(true);
    expect(result.integrated).toBe(true);
  });
});
