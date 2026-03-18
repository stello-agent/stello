import React, { useState, useEffect } from 'react';
import { StelloGraph } from '@stello-ai/visualizer';
import type { SessionData } from '@stello-ai/visualizer';

interface ExportedData {
  sessions: SessionData[];
  memories: Record<string, string>;
  exportedAt: string;
}

const App: React.FC = () => {
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [memories, setMemories] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await fetch('/data.json');
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data: ExportedData = await response.json();

        // 数据已经是正确的 SessionData 格式
        setSessions(data.sessions);
        setMemories(new Map(Object.entries(data.memories)));
        setLoading(false);
      } catch (err) {
        console.error('加载数据失败:', err);
        setError(err instanceof Error ? err.message : '未知错误');
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const handleSessionClick = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    const memory = memories.get(sessionId) || '暂无记忆';

    if (session) {
      // 格式化显示
      const info = [
        `📌 Session: ${session.label}`,
        `🆔 ID: ${sessionId.slice(0, 8)}...`,
        `📊 对话轮数: ${session.turnCount}`,
        `🌳 深度: ${session.depth ?? '未知'}`,
        session.refs.length > 0 ? `🔗 引用: ${session.refs.length} 个` : '',
        '',
        '💭 记忆摘要:',
        memory.slice(0, 300) + (memory.length > 300 ? '...' : ''),
      ].filter(Boolean).join('\n');

      alert(info);
    }
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontSize: '20px',
        color: '#888',
        flexDirection: 'column',
        gap: '10px'
      }}>
        <div>🌌 加载中...</div>
        <div style={{ fontSize: '14px' }}>正在读取 Session 数据</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontSize: '18px',
        color: '#ff6b6b',
        flexDirection: 'column',
        gap: '20px'
      }}>
        <div>❌ 加载失败</div>
        <div style={{ fontSize: '14px', color: '#999' }}>{error}</div>
        <div style={{ fontSize: '12px', color: '#666' }}>
          提示: 请先运行 <code style={{ background: '#333', padding: '2px 6px', borderRadius: '4px' }}>pnpm export</code> 导出数据
        </div>
      </div>
    );
  }

  return (
    <div style={{
      width: '100%',
      height: '100%',
      position: 'relative',
      background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)', // 苹果风格渐变背景
    }}>
      {/* 标题栏 - 液态玻璃效果 */}
      <div style={{
        position: 'absolute',
        top: '20px',
        left: '20px',
        right: '20px',
        padding: '24px 32px',
        background: 'rgba(255, 255, 255, 0.7)',
        borderRadius: '20px',
        border: '1px solid rgba(255, 255, 255, 0.5)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        boxShadow: '0 8px 32px rgba(31, 38, 135, 0.15)',
        zIndex: 10
      }}>
        <h1 style={{
          fontSize: '32px',
          fontWeight: '700',
          marginBottom: '8px',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          letterSpacing: '-0.5px'
        }}>
          Stello 对话拓扑
        </h1>
        <p style={{ fontSize: '14px', color: '#6b7280', fontWeight: '500' }}>
          {sessions.length} 个 Session · 点击节点查看详情 · 滚轮缩放 · 拖拽平移
        </p>
      </div>

      {/* 星空图 */}
      <div style={{ width: '100%', height: '100%', padding: '20px', paddingTop: '140px' }}>
        <div style={{
          width: '100%',
          height: '100%',
          background: 'rgba(255, 255, 255, 0.5)',
          borderRadius: '24px',
          border: '1px solid rgba(255, 255, 255, 0.6)',
          backdropFilter: 'blur(30px) saturate(150%)',
          WebkitBackdropFilter: 'blur(30px) saturate(150%)',
          boxShadow: '0 8px 32px rgba(31, 38, 135, 0.1)',
          overflow: 'hidden'
        }}>
          <StelloGraph
            sessions={sessions}
            memories={memories}
            onSessionClick={handleSessionClick}
            layoutConfig={{
              nodeSpacing: 180,
              depthSpacing: 250,
            }}
            renderConfig={{
              nodeSizeMin: 14,
              nodeSizeMax: 36,
              nodeColor: '#8b5cf6', // 紫色节点
              lineColor: 'rgba(139, 92, 246, 0.3)', // 淡紫色线条
              refLineColor: 'rgba(236, 72, 153, 0.5)', // 粉色引用线
              lineWidth: 2,
              refLineDash: [6, 6],
              backgroundColor: 'transparent', // 透明背景，显示外层液态玻璃
              showLabels: true,
              labelColor: '#4b5563',
              labelFont: '600 13px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
            }}
          />
        </div>
      </div>

      {/* 图例 - 液态玻璃卡片 */}
      <div style={{
        position: 'absolute',
        bottom: '30px',
        right: '30px',
        background: 'rgba(255, 255, 255, 0.7)',
        padding: '20px 24px',
        borderRadius: '16px',
        border: '1px solid rgba(255, 255, 255, 0.5)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        boxShadow: '0 8px 32px rgba(31, 38, 135, 0.15)',
        fontSize: '13px',
        minWidth: '180px'
      }}>
        <div style={{ marginBottom: '14px', fontWeight: '700', color: '#1f2937', fontSize: '15px' }}>
          图例
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
          <div style={{ width: '28px', height: '2.5px', background: 'rgba(139, 92, 246, 0.6)', borderRadius: '2px' }}></div>
          <span style={{ color: '#4b5563', fontWeight: '500' }}>父子关系</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
          <div style={{
            width: '28px',
            height: '0',
            borderTop: '2.5px dashed rgba(236, 72, 153, 0.7)',
            borderRadius: '2px'
          }}></div>
          <span style={{ color: '#4b5563', fontWeight: '500' }}>跨分支引用</span>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginTop: '14px',
          paddingTop: '14px',
          borderTop: '1px solid rgba(139, 92, 246, 0.15)'
        }}>
          <div style={{
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #8b5cf6, #a78bfa)',
            boxShadow: '0 2px 8px rgba(139, 92, 246, 0.3)'
          }}></div>
          <span style={{ color: '#6b7280', fontSize: '12px', fontWeight: '500' }}>节点大小 = 对话轮数</span>
        </div>
      </div>

      {/* 操作提示 - 液态玻璃卡片 */}
      <div style={{
        position: 'absolute',
        bottom: '30px',
        left: '30px',
        background: 'rgba(255, 255, 255, 0.7)',
        padding: '18px 24px',
        borderRadius: '16px',
        border: '1px solid rgba(255, 255, 255, 0.5)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        boxShadow: '0 8px 32px rgba(31, 38, 135, 0.15)',
        fontSize: '13px',
        color: '#6b7280'
      }}>
        <div style={{ marginBottom: '8px', fontWeight: '600', color: '#4b5563' }}>🖱️ 滚轮缩放</div>
        <div style={{ marginBottom: '8px', fontWeight: '600', color: '#4b5563' }}>👆 拖拽平移</div>
        <div style={{ fontWeight: '600', color: '#4b5563' }}>💬 点击查看详情</div>
      </div>
    </div>
  );
};

export default App;
