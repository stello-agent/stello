import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeFileSystemAdapter } from '../../fs/file-system-adapter';
import { SessionTreeImpl } from '../../session/session-tree';
import { FileSystemMemoryEngine } from '../file-system-memory-engine';
import type { TurnRecord } from '../../types/memory';

/** 创建临时目录并初始化 engine */
async function makeEngine() {
  const dir = await mkdtemp(join(tmpdir(), 'stello-mem-'));
  const fs = new NodeFileSystemAdapter(dir);
  const sessions = new SessionTreeImpl(fs);
  const engine = new FileSystemMemoryEngine(fs, sessions);
  return { dir, fs, sessions, engine };
}

/** 构造一条测试用 TurnRecord */
function makeRecord(role: TurnRecord['role'], content: string): TurnRecord {
  return { role, content, timestamp: new Date().toISOString() };
}

describe('FileSystemMemoryEngine', () => {
  let dir: string;
  let engine: FileSystemMemoryEngine;
  let sessions: SessionTreeImpl;
  let adapter: NodeFileSystemAdapter;

  beforeEach(async () => {
    const ctx = await makeEngine();
    dir = ctx.dir;
    engine = ctx.engine;
    sessions = ctx.sessions;
    adapter = ctx.fs;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ─── L1 core ───────────────────────────────────────────────────────────────

  describe('L1 core (core.json)', () => {
    it('readCore() returns null when file does not exist', async () => {
      const result = await engine.readCore();
      expect(result).toBeNull();
    });

    it('readCore() returns full object after write', async () => {
      await engine.writeCore('name', 'Alice');
      await engine.writeCore('age', 30);
      const result = await engine.readCore();
      expect(result).toEqual({ name: 'Alice', age: 30 });
    });

    it('writeCore / readCore round-trip for simple key', async () => {
      await engine.writeCore('key', 'value');
      const result = await engine.readCore('key');
      expect(result).toBe('value');
    });

    it('readCore(path) returns null for missing key', async () => {
      await engine.writeCore('a', 1);
      const result = await engine.readCore('nonexistent');
      expect(result).toBeNull();
    });

    it('writeCore supports nested dot-path (a.b)', async () => {
      await engine.writeCore('a.b', 42);
      const result = await engine.readCore('a.b');
      expect(result).toBe(42);
    });

    it('writeCore nested dot-path preserves sibling keys', async () => {
      await engine.writeCore('profile.name', 'Alice');
      await engine.writeCore('profile.age', 25);
      const full = await engine.readCore() as Record<string, unknown>;
      expect((full['profile'] as Record<string, unknown>)['name']).toBe('Alice');
      expect((full['profile'] as Record<string, unknown>)['age']).toBe(25);
    });

    it('writeCore overwrites existing value', async () => {
      await engine.writeCore('x', 1);
      await engine.writeCore('x', 2);
      expect(await engine.readCore('x')).toBe(2);
    });
  });

  // ─── L2 per-session ────────────────────────────────────────────────────────

  describe('L2 per-session markdown files', () => {
    it('readMemory returns null for non-existent session', async () => {
      const result = await engine.readMemory('no-such-id');
      expect(result).toBeNull();
    });

    it('writeMemory / readMemory round-trip', async () => {
      const node = await sessions.createRoot('Test Root');
      await engine.writeMemory(node.id, '# Memory\nSome content');
      const result = await engine.readMemory(node.id);
      expect(result).toBe('# Memory\nSome content');
    });

    it('readScope returns null for non-existent session', async () => {
      expect(await engine.readScope('no-such-id')).toBeNull();
    });

    it('writeScope / readScope round-trip', async () => {
      const node = await sessions.createRoot('Root');
      await engine.writeScope(node.id, '# Scope');
      expect(await engine.readScope(node.id)).toBe('# Scope');
    });

    it('readIndex returns null for non-existent session', async () => {
      expect(await engine.readIndex('no-such-id')).toBeNull();
    });

    it('writeIndex / readIndex round-trip', async () => {
      const node = await sessions.createRoot('Root');
      await engine.writeIndex(node.id, '# Index');
      expect(await engine.readIndex(node.id)).toBe('# Index');
    });

    it('writeMemory creates directory if needed', async () => {
      // Use a fresh ID that has no directory yet
      const id = 'new-session-id';
      await engine.writeMemory(id, 'content');
      expect(await engine.readMemory(id)).toBe('content');
    });
  });

  // ─── L3 JSONL records ──────────────────────────────────────────────────────

  describe('L3 JSONL records', () => {
    it('readRecords returns empty array for non-existent session', async () => {
      const result = await engine.readRecords('no-such-id');
      expect(result).toEqual([]);
    });

    it('appendRecord / readRecords round-trip', async () => {
      const node = await sessions.createRoot('Root');
      const record = makeRecord('user', 'Hello');
      await engine.appendRecord(node.id, record);
      const records = await engine.readRecords(node.id);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ role: 'user', content: 'Hello' });
    });

    it('appendRecord preserves insertion order', async () => {
      const node = await sessions.createRoot('Root');
      await engine.appendRecord(node.id, makeRecord('user', 'first'));
      await engine.appendRecord(node.id, makeRecord('assistant', 'second'));
      await engine.appendRecord(node.id, makeRecord('user', 'third'));
      const records = await engine.readRecords(node.id);
      expect(records).toHaveLength(3);
      expect(records[0]!.content).toBe('first');
      expect(records[1]!.content).toBe('second');
      expect(records[2]!.content).toBe('third');
    });

    it('replaceRecords overwrites all records', async () => {
      const node = await sessions.createRoot('Root');
      await engine.appendRecord(node.id, makeRecord('user', 'old'));
      const newRecords: TurnRecord[] = [
        makeRecord('user', 'new1'),
        makeRecord('assistant', 'new2'),
      ];
      await engine.replaceRecords(node.id, newRecords);
      const records = await engine.readRecords(node.id);
      expect(records).toHaveLength(2);
      expect(records[0]!.content).toBe('new1');
      expect(records[1]!.content).toBe('new2');
    });

    it('replaceRecords with empty array clears records', async () => {
      const node = await sessions.createRoot('Root');
      await engine.appendRecord(node.id, makeRecord('user', 'data'));
      await engine.replaceRecords(node.id, []);
      const records = await engine.readRecords(node.id);
      expect(records).toEqual([]);
    });

    it('appendRecord preserves metadata field', async () => {
      const node = await sessions.createRoot('Root');
      const record: TurnRecord = {
        role: 'tool',
        content: 'result',
        timestamp: new Date().toISOString(),
        metadata: { toolId: 'search', exitCode: 0 },
      };
      await engine.appendRecord(node.id, record);
      const records = await engine.readRecords(node.id);
      expect(records[0]!.metadata).toEqual({ toolId: 'search', exitCode: 0 });
    });

    it('readRecords skips corrupt lines', async () => {
      const node = await (sessions as SessionTreeImpl).createRoot('test')
      const good: TurnRecord = { role: 'user', content: 'hi', timestamp: '2026-01-01T00:00:00Z' }
      await engine.appendRecord(node.id, good)
      // Manually inject a corrupt line
      await adapter.appendLine(`sessions/${node.id}/records.jsonl`, 'not-valid-json{')
      const records = await engine.readRecords(node.id)
      expect(records).toHaveLength(1)
      expect(records[0]!.content).toBe('hi')
    });
  });

  // ─── assembleContext ────────────────────────────────────────────────────────

  describe('assembleContext', () => {
    it('returns empty core and no memories for root with no data', async () => {
      const root = await sessions.createRoot('Root');
      // Need core.json to exist (createRoot does this)
      const ctx = await engine.assembleContext(root.id);
      expect(ctx.core).toEqual({});
      expect(ctx.memories).toEqual([]);
      expect(ctx.currentMemory).toBeNull();
      expect(ctx.scope).toBeNull();
    });

    it('includes currentMemory and scope for session', async () => {
      const root = await sessions.createRoot('Root');
      await engine.writeMemory(root.id, '# Root Memory');
      await engine.writeScope(root.id, '# Root Scope');
      const ctx = await engine.assembleContext(root.id);
      expect(ctx.currentMemory).toBe('# Root Memory');
      expect(ctx.scope).toBe('# Root Scope');
    });

    it('collects ancestor memories from parent to root', async () => {
      const root = await sessions.createRoot('Root');
      await engine.writeMemory(root.id, '# Root Memory');
      const child = await sessions.createChild({ parentId: root.id, label: 'Child' });
      await engine.writeMemory(child.id, '# Child Memory');
      const grandchild = await sessions.createChild({ parentId: child.id, label: 'Grandchild' });

      const ctx = await engine.assembleContext(grandchild.id);
      // ancestors from parent to root: [child, root]
      expect(ctx.memories).toHaveLength(2);
      expect(ctx.memories[0]).toBe('# Child Memory');
      expect(ctx.memories[1]).toBe('# Root Memory');
      expect(ctx.currentMemory).toBeNull();
    });

    it('includes L1 core data in context', async () => {
      const root = await sessions.createRoot('Root');
      await engine.writeCore('user', 'Bob');
      const ctx = await engine.assembleContext(root.id);
      expect(ctx.core).toEqual({ user: 'Bob' });
    });

    it('skips ancestors with no memory', async () => {
      const root = await sessions.createRoot('Root');
      // no memory written to root
      const child = await sessions.createChild({ parentId: root.id, label: 'Child' });
      const ctx = await engine.assembleContext(child.id);
      expect(ctx.memories).toEqual([]);
    });
  });
});
