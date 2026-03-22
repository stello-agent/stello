import { describe, it, expect, vi } from 'vitest';
import { Scheduler } from '../scheduler';

describe('Scheduler', () => {
  it('达到 everyNTurns 阈值时触发 consolidate', async () => {
    const session = {
      meta: { id: 's1', turnCount: 4, consolidatedTurn: 2 },
      consolidate: vi.fn().mockResolvedValue(undefined),
    };
    const mainSession = {
      integrate: vi.fn().mockResolvedValue(undefined),
    };

    const scheduler = new Scheduler({
      consolidation: { mode: 'everyNTurns', everyNTurns: 2 },
      integration: { mode: 'manual' },
      consolidateFn: { kind: 'consolidate' },
    });

    const result = await scheduler.afterTurn(session, mainSession);

    expect(session.consolidate).toHaveBeenCalledTimes(1);
    expect(session.consolidate).toHaveBeenCalledWith({ kind: 'consolidate' });
    expect(mainSession.integrate).not.toHaveBeenCalled();
    expect(result).toEqual({ consolidated: true, integrated: false });
  });

  it('未达到阈值时不触发 consolidate', async () => {
    const session = {
      meta: { id: 's1', turnCount: 3, consolidatedTurn: 2 },
      consolidate: vi.fn().mockResolvedValue(undefined),
    };
    const mainSession = {
      integrate: vi.fn().mockResolvedValue(undefined),
    };

    const scheduler = new Scheduler({
      consolidation: { mode: 'everyNTurns', everyNTurns: 2 },
      integration: { mode: 'manual' },
    });

    const result = await scheduler.afterTurn(session, mainSession);

    expect(session.consolidate).not.toHaveBeenCalled();
    expect(mainSession.integrate).not.toHaveBeenCalled();
    expect(result).toEqual({ consolidated: false, integrated: false });
  });

  it('consolidate 成功后按 afterConsolidate 策略触发 integrate', async () => {
    const session = {
      meta: { id: 's1', turnCount: 6, consolidatedTurn: 4 },
      consolidate: vi.fn().mockResolvedValue(undefined),
    };
    const mainSession = {
      integrate: vi.fn().mockResolvedValue('ok'),
    };

    const scheduler = new Scheduler({
      consolidation: { mode: 'everyNTurns', everyNTurns: 3 },
      integration: { mode: 'afterConsolidate' },
      consolidateFn: { kind: 'consolidate' },
      integrateFn: { kind: 'integrate' },
    });

    const result = await scheduler.afterTurn(session, mainSession);

    expect(session.consolidate).toHaveBeenCalledTimes(1);
    expect(mainSession.integrate).toHaveBeenCalledTimes(1);
    expect(mainSession.integrate).toHaveBeenCalledWith({ kind: 'integrate' });
    expect(result).toEqual({ consolidated: true, integrated: true });
  });

  it('consolidate 失败不阻断主路径，并通过 onError 上报', async () => {
    const session = {
      meta: { id: 's1', turnCount: 4, consolidatedTurn: 2 },
      consolidate: vi.fn().mockRejectedValue(new Error('consolidate failed')),
    };
    const mainSession = {
      integrate: vi.fn().mockResolvedValue(undefined),
    };
    const onError = vi.fn();

    const scheduler = new Scheduler({
      consolidation: { mode: 'everyNTurns', everyNTurns: 2 },
      integration: { mode: 'afterConsolidate' },
      onError,
    });

    const result = await scheduler.afterTurn(session, mainSession);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe('scheduler.consolidate');
    expect(onError.mock.calls[0]?.[1]).toBeInstanceOf(Error);
    expect(mainSession.integrate).not.toHaveBeenCalled();
    expect(result).toEqual({ consolidated: false, integrated: false });
  });

  it('按 integrate everyNTurns 策略独立触发 integrate', async () => {
    const session = {
      meta: { id: 's1', turnCount: 6, consolidatedTurn: 6 },
      consolidate: vi.fn().mockResolvedValue(undefined),
    };
    const mainSession = {
      integrate: vi.fn().mockResolvedValue(undefined),
    };

    const scheduler = new Scheduler({
      consolidation: { mode: 'manual' },
      integration: { mode: 'everyNTurns', everyNTurns: 3 },
      integrateFn: { kind: 'integrate' },
    });

    const result = await scheduler.afterTurn(session, mainSession);

    expect(session.consolidate).not.toHaveBeenCalled();
    expect(mainSession.integrate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ consolidated: false, integrated: true });
  });

  it('onSwitch 策略在切换时触发 consolidate 和 integrate', async () => {
    const session = {
      meta: { id: 's1', turnCount: 1, consolidatedTurn: 0 },
      consolidate: vi.fn().mockResolvedValue(undefined),
    };
    const mainSession = {
      integrate: vi.fn().mockResolvedValue(undefined),
    };

    const scheduler = new Scheduler({
      consolidation: { mode: 'onSwitch' },
      integration: { mode: 'onSwitch' },
      consolidateFn: { kind: 'switch-consolidate' },
      integrateFn: { kind: 'switch-integrate' },
    });

    const result = await scheduler.onSessionSwitch(session, mainSession);

    expect(session.consolidate).toHaveBeenCalledWith({ kind: 'switch-consolidate' });
    expect(mainSession.integrate).toHaveBeenCalledWith({ kind: 'switch-integrate' });
    expect(result).toEqual({ consolidated: true, integrated: true });
  });

  it('onArchive 策略在归档时触发 consolidate', async () => {
    const session = {
      meta: { id: 's1', turnCount: 5, consolidatedTurn: 4 },
      consolidate: vi.fn().mockResolvedValue(undefined),
    };
    const mainSession = {
      integrate: vi.fn().mockResolvedValue(undefined),
    };

    const scheduler = new Scheduler({
      consolidation: { mode: 'onArchive' },
      integration: { mode: 'manual' },
    });

    const result = await scheduler.onSessionArchive(session, mainSession);

    expect(session.consolidate).toHaveBeenCalledTimes(1);
    expect(mainSession.integrate).not.toHaveBeenCalled();
    expect(result).toEqual({ consolidated: true, integrated: false });
  });
});
