import { describe, it, expect } from 'vitest';
import type { SessionTreeNode } from '../../types/session.js';
import { renderTopologyMarkdown } from '../topology-render.js';

function node(id: string, label: string, children: SessionTreeNode[] = [], status: 'active' | 'archived' = 'active'): SessionTreeNode {
  return { id, label, parentId: null, status, children } as SessionTreeNode;
}

describe('renderTopologyMarkdown', () => {
  it('renders a single root node', () => {
    const root = node('r1', 'Root');
    expect(renderTopologyMarkdown(root)).toBe('- [sessionId=r1] Root');
  });

  it('renders nested children with indentation', () => {
    const root = node('r1', 'Root', [node('c1', 'Child', [node('g1', 'Grand')])]);
    expect(renderTopologyMarkdown(root)).toBe(
      '- [sessionId=r1] Root\n  - [sessionId=c1] Child\n    - [sessionId=g1] Grand',
    );
  });

  it('marks archived nodes', () => {
    const root = node('r1', 'Root', [node('c1', 'Old', [], 'archived')]);
    expect(renderTopologyMarkdown(root)).toBe(
      '- [sessionId=r1] Root\n  - [sessionId=c1] Old (archived)',
    );
  });

  it('appends YOU ARE HERE marker when currentSessionId matches a node', () => {
    const root = node('r1', 'Root', [node('c1', 'Child')]);
    expect(renderTopologyMarkdown(root, 'c1')).toBe(
      '- [sessionId=r1] Root\n  - [sessionId=c1] Child ← YOU ARE HERE',
    );
  });

  it('does not mark when currentSessionId does not match any node', () => {
    const root = node('r1', 'Root', [node('c1', 'Child')]);
    expect(renderTopologyMarkdown(root, 'absent')).toBe(
      '- [sessionId=r1] Root\n  - [sessionId=c1] Child',
    );
  });
});
