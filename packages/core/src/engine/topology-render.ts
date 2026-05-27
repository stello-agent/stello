import type { SessionTreeNode } from '../types/session.js';

/**
 * Render a SessionTree subtree as a markdown bullet list.
 *
 * Each node is rendered as `- [sessionId={id}] {label}`. Archived nodes get
 * a ` (archived)` suffix. If `currentSessionId` matches a node, that node
 * gets a ` ← YOU ARE HERE` suffix so the LLM can self-locate.
 */
export function renderTopologyMarkdown(root: SessionTreeNode, currentSessionId?: string): string {
  const lines: string[] = [];
  function walk(node: SessionTreeNode, indent: string): void {
    const archived = node.status === 'archived' ? ' (archived)' : '';
    const here = node.id === currentSessionId ? ' ← YOU ARE HERE' : '';
    lines.push(`${indent}- [sessionId=${node.id}] ${node.label}${archived}${here}`);
    for (const child of node.children) walk(child, indent + '  ');
  }
  walk(root, '');
  return lines.join('\n');
}
