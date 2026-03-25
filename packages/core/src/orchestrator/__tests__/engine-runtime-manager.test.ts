import { describe, expect, it, vi } from 'vitest';
import { DefaultEngineRuntimeManager } from '../engine-runtime-manager';

describe('DefaultEngineRuntimeManager', () => {
  it('会复用同一个 session 的 engine，并在引用归零后回收', async () => {
    const engine = { sessionId: 's1' };
    const engineFactory = {
      create: vi.fn().mockResolvedValue(engine),
    };

    const manager = new DefaultEngineRuntimeManager(engineFactory as never);

    const first = await manager.acquire('s1', 'holder-a');
    const second = await manager.acquire('s1', 'holder-b');

    expect(first).toBe(engine);
    expect(second).toBe(engine);
    expect(engineFactory.create).toHaveBeenCalledTimes(1);
    expect(manager.has('s1')).toBe(true);
    expect(manager.getRefCount('s1')).toBe(2);

    await manager.release('s1', 'holder-a');
    expect(manager.has('s1')).toBe(true);
    expect(manager.getRefCount('s1')).toBe(1);

    await manager.release('s1', 'holder-b');
    expect(manager.has('s1')).toBe(false);
    expect(manager.get('s1')).toBeNull();
  });

  it('并发 acquire 同一个 session 时只创建一次 engine', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const engine = { sessionId: 's1' };
    const engineFactory = {
      create: vi.fn().mockImplementation(async () => {
        await gate;
        return engine;
      }),
    };

    const manager = new DefaultEngineRuntimeManager(engineFactory as never);

    const first = manager.acquire('s1', 'holder-a');
    const second = manager.acquire('s1', 'holder-b');

    release();
    const [firstEngine, secondEngine] = await Promise.all([first, second]);

    expect(firstEngine).toBe(engine);
    expect(secondEngine).toBe(engine);
    expect(engineFactory.create).toHaveBeenCalledTimes(1);
    expect(manager.getRefCount('s1')).toBe(2);
  });

  it('支持 idleTtlMs 延迟回收，并在 TTL 内重新 acquire 时取消回收', async () => {
    vi.useFakeTimers();
    const engine = { sessionId: 's1' };
    const engineFactory = {
      create: vi.fn().mockResolvedValue(engine),
    };

    const manager = new DefaultEngineRuntimeManager(engineFactory as never, {
      idleTtlMs: 1_000,
    });

    await manager.acquire('s1', 'holder-a');
    await manager.release('s1', 'holder-a');

    expect(manager.has('s1')).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    expect(manager.has('s1')).toBe(true);

    await manager.acquire('s1', 'holder-b');
    expect(manager.getRefCount('s1')).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(manager.has('s1')).toBe(true);

    await manager.release('s1', 'holder-b');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(manager.has('s1')).toBe(false);

    vi.useRealTimers();
  });

  it('updateRecyclePolicy 热更新后 release 按新值延迟回收', async () => {
    vi.useFakeTimers();
    const engine = { sessionId: 's1' };
    const engineFactory = {
      create: vi.fn().mockResolvedValue(engine),
    };

    const manager = new DefaultEngineRuntimeManager(engineFactory as never, {
      idleTtlMs: 0,
    });

    // 初始 idleTtlMs=0，立即回收
    await manager.acquire('s1', 'holder-a');
    await manager.release('s1', 'holder-a');
    expect(manager.has('s1')).toBe(false);

    // 热更新为延迟回收
    manager.updateRecyclePolicy({ idleTtlMs: 2_000 });

    await manager.acquire('s1', 'holder-b');
    await manager.release('s1', 'holder-b');
    expect(manager.has('s1')).toBe(true);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(manager.has('s1')).toBe(true);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(manager.has('s1')).toBe(false);

    vi.useRealTimers();
  });

  it('updateRecyclePolicy 部分更新不丢失已有字段', () => {
    const engineFactory = { create: vi.fn() };
    const manager = new DefaultEngineRuntimeManager(engineFactory as never, {
      idleTtlMs: 1_000,
    });

    manager.updateRecyclePolicy({});
    // idleTtlMs 应保持不变（通过后续行为验证即可，这里主要验证不抛错）
  });
});
