import { useRef, useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { GitBranch, Archive, MessageSquare, Search, X } from 'lucide-react'
import { fetchSessions, type SessionMeta, type TopologyNode as ApiTopoNode } from '@/lib/api'

/** 拓扑节点（前端渲染用，合并 meta + topology） */
interface TopoNode {
  id: string
  label: string
  parentId: string | null
  status: 'active' | 'archived'
  turns: number
  children: string[]
  refs: string[]
}

/** 布局后节点 */
interface LayoutNode extends TopoNode {
  x: number
  y: number
  size: number
  color: string
  glowColor: string
  brightness: number
}

/* 无 mock 数据——全部从 API 拉取 */

/** 节点颜色映射 */
function getNodeStyle(node: TopoNode, isMain: boolean): { color: string; glowColor: string } {
  if (isMain) return { color: '#C4A882', glowColor: 'rgba(196,168,130,0.5)' }
  if (node.status === 'archived') return { color: '#D89575', glowColor: 'rgba(216,149,117,0.3)' }
  if (node.children.length === 0) return { color: '#A8C4A0', glowColor: 'rgba(168,196,160,0.3)' }
  return { color: '#B8956A', glowColor: 'rgba(184,149,106,0.35)' }
}

/** 同心环布局算法 */
function computeLayout(nodes: TopoNode[], width: number, height: number): LayoutNode[] {
  const cx = width / 2
  const cy = height / 2
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const result: LayoutNode[] = []

  /* BFS 分层 */
  const root = nodes.find((n) => n.parentId === null)
  if (!root) return result

  const layers: TopoNode[][] = [[root]]
  const visited = new Set([root.id])
  let current = [root]

  while (current.length > 0) {
    const next: TopoNode[] = []
    for (const node of current) {
      for (const childId of node.children) {
        const child = nodeMap.get(childId)
        if (child && !visited.has(child.id)) {
          visited.add(child.id)
          next.push(child)
        }
      }
    }
    if (next.length > 0) layers.push(next)
    current = next
  }

  /* 按层分配位置 */
  const ringSpacing = Math.min(width, height) * 0.18
  const maxTurns = Math.max(...nodes.map((n) => n.turns), 1)

  for (let layer = 0; layer < layers.length; layer++) {
    const ring = layers[layer]!
    const radius = layer === 0 ? 0 : ringSpacing * layer

    for (let i = 0; i < ring.length; i++) {
      const node = ring[i]!
      const isMain = node.parentId === null
      const angle = ring.length === 1 ? 0 : (2 * Math.PI * i) / ring.length - Math.PI / 2

      /* 加一点随机偏移让星空图更自然 */
      const jitterX = layer === 0 ? 0 : (Math.sin(i * 7.3 + layer * 2.1) * ringSpacing * 0.15)
      const jitterY = layer === 0 ? 0 : (Math.cos(i * 5.7 + layer * 3.4) * ringSpacing * 0.15)

      const x = cx + Math.cos(angle) * radius + jitterX
      const y = cy + Math.sin(angle) * radius + jitterY

      const sizeBase = isMain ? 18 : 6
      const sizeScale = (node.turns / maxTurns) * 10
      const size = sizeBase + sizeScale

      const { color, glowColor } = getNodeStyle(node, isMain)
      const brightness = node.status === 'archived' ? 0.5 : 0.8 + (node.turns / maxTurns) * 0.2

      result.push({ ...node, x, y, size, color, glowColor, brightness })
    }
  }

  return result
}

/** 判断节点是否与 highlightedId 相邻 */
function isAdjacent(node: LayoutNode, highlightedId: string | null, nodeMap: Map<string, LayoutNode>): boolean {
  if (!highlightedId) return false
  if (node.id === highlightedId) return true
  if (node.parentId === highlightedId) return true
  const highlighted = nodeMap.get(highlightedId)
  if (highlighted?.parentId === node.id) return true
  if (node.refs.includes(highlightedId)) return true
  if (highlighted?.refs.includes(node.id)) return true
  return false
}

/** 渲染一帧（带动画时间）——调用前 ctx 已经设置好 camera 变换 */
function renderFrame(
  ctx: CanvasRenderingContext2D,
  nodes: LayoutNode[],
  width: number,
  height: number,
  highlightedId: string | null,
  time: number = 0,
) {
  /* 背景渐变——需要覆盖可见区域（考虑平移后的范围） */
  const margin = 2000
  const grad = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width)
  grad.addColorStop(0, '#2A2520')
  grad.addColorStop(1, '#1A1815')
  ctx.fillStyle = grad
  ctx.fillRect(-margin, -margin, width + margin * 2, height + margin * 2)

  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const hasHighlight = highlightedId !== null

  /* 画父子连线 */
  for (const node of nodes) {
    if (!node.parentId) continue
    const parent = nodeMap.get(node.parentId)
    if (!parent) continue

    const adjacent = hasHighlight && (
      isAdjacent(node, highlightedId, nodeMap) && isAdjacent(parent, highlightedId, nodeMap)
    )

    ctx.beginPath()
    ctx.moveTo(parent.x, parent.y)
    ctx.lineTo(node.x, node.y)
    ctx.strokeStyle = adjacent
      ? 'rgba(196,168,130,0.8)'
      : hasHighlight ? 'rgba(196,168,130,0.15)' : 'rgba(196,168,130,0.5)'
    ctx.lineWidth = adjacent ? 3 : parent.parentId === null ? 2.5 : 1.5
    ctx.shadowColor = adjacent ? 'rgba(196,168,130,0.5)' : 'rgba(196,168,130,0.25)'
    ctx.shadowBlur = adjacent ? 12 : 8
    ctx.stroke()
    ctx.shadowBlur = 0
  }

  /* 画跨分支引用虚线 */
  for (const node of nodes) {
    for (const refId of node.refs) {
      const ref = nodeMap.get(refId)
      if (!ref) continue

      const adjacent = hasHighlight && (
        isAdjacent(node, highlightedId, nodeMap) && isAdjacent(ref, highlightedId, nodeMap)
      )

      ctx.beginPath()
      ctx.moveTo(node.x, node.y)
      ctx.lineTo(ref.x, ref.y)
      ctx.strokeStyle = adjacent
        ? 'rgba(216,149,117,0.8)'
        : hasHighlight ? 'rgba(216,149,117,0.12)' : 'rgba(216,149,117,0.5)'
      ctx.lineWidth = adjacent ? 2 : 1.5
      ctx.setLineDash([6, 4])
      ctx.shadowColor = 'rgba(216,149,117,0.2)'
      ctx.shadowBlur = adjacent ? 10 : 6
      ctx.stroke()
      ctx.setLineDash([])
      ctx.shadowBlur = 0
    }
  }

  /* 画节点 */
  for (const node of nodes) {
    const isHighlighted = node.id === highlightedId
    const adjacent = isAdjacent(node, highlightedId, nodeMap)
    const dimmed = hasHighlight && !adjacent

    /* 呼吸脉冲：每个节点错开相位 */
    const pulse = Math.sin(time * 0.002 + node.x * 0.01 + node.y * 0.01) * 0.15 + 1
    const animatedSize = node.size * (isHighlighted ? 1.2 : pulse)

    /* 发光效果 */
    ctx.beginPath()
    ctx.arc(node.x, node.y, animatedSize, 0, Math.PI * 2)
    ctx.fillStyle = node.color
    ctx.globalAlpha = dimmed ? 0.25 : node.brightness
    ctx.shadowColor = node.glowColor
    ctx.shadowBlur = isHighlighted ? 35 : dimmed ? 4 : node.size + 8
    ctx.fill()
    ctx.shadowBlur = 0

    /* 高亮光环 */
    if (isHighlighted) {
      ctx.beginPath()
      ctx.arc(node.x, node.y, animatedSize + 4, 0, Math.PI * 2)
      ctx.strokeStyle = node.color
      ctx.lineWidth = 1.5
      ctx.globalAlpha = 0.4 + Math.sin(time * 0.005) * 0.2
      ctx.stroke()
    }

    ctx.globalAlpha = 1

    /* 节点标签 */
    ctx.font = `${node.parentId === null ? '600' : '500'} ${node.parentId === null ? 11 : 9}px Outfit, system-ui`
    ctx.fillStyle = node.color
    ctx.globalAlpha = dimmed ? 0.2 : node.status === 'archived' ? 0.5 : 0.8
    ctx.textAlign = 'left'
    ctx.fillText(node.label, node.x + animatedSize + 6, node.y + 4)
    ctx.globalAlpha = 1
  }
}

/** Tooltip 状态 */
interface TooltipState {
  visible: boolean
  x: number
  y: number
  node: LayoutNode | null
}

/** Camera 状态 */
interface Camera {
  x: number
  y: number
  zoom: number
  /* 惯性速度 */
  vx: number
  vy: number
}

/** 屏幕坐标 → 世界坐标 */
function screenToWorld(sx: number, sy: number, cam: Camera): { wx: number; wy: number } {
  return { wx: sx / cam.zoom - cam.x, wy: sy / cam.zoom - cam.y }
}

/** 世界坐标 → 屏幕坐标 */
function worldToScreen(wx: number, wy: number, cam: Camera): { sx: number; sy: number } {
  return { sx: (wx + cam.x) * cam.zoom, sy: (wy + cam.y) * cam.zoom }
}

/** Topology 星空图页面 */
export function Topology() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nodesRef = useRef<LayoutNode[]>([])
  const [topoNodes, setTopoNodes] = useState<TopoNode[]>([])
  const [dataError, setDataError] = useState<string | null>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, x: 0, y: 0, node: null })
  const [selectedNode, setSelectedNode] = useState<LayoutNode | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const navigate = useNavigate()

  /* Camera ref（不触发 re-render，rAF 循环直接读取） */
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1, vx: 0, vy: 0 })
  const dragRef = useRef<{
    active: boolean
    startX: number
    startY: number
    lastX: number
    lastY: number
    draggingNodeId: string | null
    hasMoved: boolean
  }>({ active: false, startX: 0, startY: 0, lastX: 0, lastY: 0, draggingNodeId: null, hasMoved: false })
  const highlightedRef = useRef<string | null>(null)

  /* 同步 highlighted 到 ref（rAF 读取） */
  useEffect(() => { highlightedRef.current = highlighted }, [highlighted])

  /* 从 API 拉取完整拓扑树 */
  useEffect(() => {
    import('@/lib/api').then(({ fetchSessionTree }) =>
      fetchSessionTree().then((tree) => {
        const flattenTree = (node: typeof tree): TopoNode[] => {
          const topo: TopoNode = {
            id: node.node.id,
            label: node.node.label,
            parentId: node.node.parentId,
            status: node.meta.status,
            turns: node.meta.turnCount,
            children: node.node.children,
            refs: node.node.refs,
          }
          return [topo, ...node.children.flatMap(flattenTree)]
        }
        const all = flattenTree(tree)
        setTopoNodes(all)
        setDataError(null)
      }).catch((err: Error) => {
        setDataError(err.message)
      })
    )
  }, [])

  /* ResizeObserver */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ width, height })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  /* 布局计算 */
  useEffect(() => {
    const layout = computeLayout(topoNodes, size.width, size.height)
    nodesRef.current = layout
  }, [size, topoNodes])

  /* rAF 动画循环——读 cameraRef，带惯性衰减 */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = size.width * dpr
    canvas.height = size.height * dpr

    let rafId: number
    const loop = (time: number) => {
      const cam = cameraRef.current

      /* 惯性衰减 */
      if (!dragRef.current.active && (Math.abs(cam.vx) > 0.1 || Math.abs(cam.vy) > 0.1)) {
        cam.x += cam.vx
        cam.y += cam.vy
        cam.vx *= 0.92
        cam.vy *= 0.92
      } else if (!dragRef.current.active) {
        cam.vx = 0
        cam.vy = 0
      }

      /* 应用 camera 变换 */
      ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * cam.x * cam.zoom, dpr * cam.y * cam.zoom)
      renderFrame(ctx, nodesRef.current, size.width / cam.zoom, size.height / cam.zoom, highlightedRef.current, time)

      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [size])

  /* 命中测试（屏幕坐标 → 世界坐标 → 找节点） */
  const hitTest = useCallback((screenX: number, screenY: number): LayoutNode | null => {
    const cam = cameraRef.current
    const { wx, wy } = screenToWorld(screenX, screenY, cam)
    return nodesRef.current.find((n) => {
      const dx = n.x - wx
      const dy = n.y - wy
      return dx * dx + dy * dy <= (n.size + 6) * (n.size + 6)
    }) ?? null
  }, [])

  /* mousedown */
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top

    const hit = hitTest(sx, sy)
    const cam = cameraRef.current
    cam.vx = 0
    cam.vy = 0

    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      draggingNodeId: hit?.id ?? null,
      hasMoved: false,
    }
  }, [hitTest])

  /* mousemove */
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const drag = dragRef.current
    const cam = cameraRef.current

    if (drag.active) {
      const dx = e.clientX - drag.lastX
      const dy = e.clientY - drag.lastY

      if (Math.abs(e.clientX - drag.startX) > 3 || Math.abs(e.clientY - drag.startY) > 3) {
        drag.hasMoved = true
      }

      if (drag.draggingNodeId) {
        /* 拖拽节点 */
        const node = nodesRef.current.find((n) => n.id === drag.draggingNodeId)
        if (node) {
          node.x += dx / cam.zoom
          node.y += dy / cam.zoom
        }
        canvas.style.cursor = 'grabbing'
      } else {
        /* 拖拽平移画布 */
        cam.x += dx / cam.zoom
        cam.y += dy / cam.zoom
        cam.vx = dx / cam.zoom * 0.3
        cam.vy = dy / cam.zoom * 0.3
        canvas.style.cursor = 'grabbing'
      }

      drag.lastX = e.clientX
      drag.lastY = e.clientY
      setTooltip({ visible: false, x: 0, y: 0, node: null })
    } else {
      /* hover 检测 */
      const hit = hitTest(sx, sy)
      if (hit) {
        setHighlighted(hit.id)
        setTooltip({ visible: true, x: e.clientX, y: e.clientY, node: hit })
        canvas.style.cursor = 'pointer'
      } else {
        setHighlighted(null)
        setTooltip({ visible: false, x: 0, y: 0, node: null })
        canvas.style.cursor = 'grab'
      }
    }
  }, [hitTest])

  /* mouseup */
  const handleMouseUp = useCallback(() => {
    const drag = dragRef.current
    if (drag.active && !drag.hasMoved) {
      /* 点击（没有拖动） */
      if (drag.draggingNodeId) {
        const node = nodesRef.current.find((n) => n.id === drag.draggingNodeId)
        setSelectedNode(node ?? null)
        setPanelOpen(true)
      } else {
        setPanelOpen(false)
      }
    }
    drag.active = false
    drag.draggingNodeId = null
    if (canvasRef.current) canvasRef.current.style.cursor = 'grab'
  }, [])

  /* wheel 缩放 */
  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const cam = cameraRef.current
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    /* 缩放前的世界坐标 */
    const { wx, wy } = screenToWorld(mouseX, mouseY, cam)

    /* 计算新 zoom */
    const factor = e.deltaY > 0 ? 0.92 : 1.08
    const newZoom = Math.max(0.3, Math.min(3, cam.zoom * factor))
    cam.zoom = newZoom

    /* 缩放后保持鼠标位置对应同一世界坐标 */
    cam.x = mouseX / newZoom - wx
    cam.y = mouseY / newZoom - wy
  }, [])

  /* 双击节点跳转 Conversation */
  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top)
    if (hit) {
      navigate(`/conversation?session=${hit.id}`)
    }
  }, [hitTest, navigate])

  /** 关闭面板 */
  const closePanel = useCallback(() => {
    setPanelOpen(false)
    setTimeout(() => setSelectedNode(null), 250)
  }, [])

  return (
    <div className="flex h-full">
      {/* 星空图画布 */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onDoubleClick={handleDoubleClick}
        />

        {/* 顶部标题栏 */}
        <div className="absolute top-5 left-6 flex items-center gap-3">
          <span className="text-base font-semibold text-[#E5E4E1]">Session Topology</span>
          {topoNodes.length > 0 && (
            <div className="flex items-center gap-1 bg-primary/15 rounded-full px-2.5 py-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-primary" />
              <span className="text-[11px] font-medium text-primary">{topoNodes.length} sessions</span>
            </div>
          )}
        </div>

        {/* 错误/空状态 */}
        {dataError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-[#2A2520]/90 border border-error/30 rounded-lg px-6 py-4 max-w-md text-center">
              <p className="text-sm font-semibold text-error mb-1">Failed to load sessions</p>
              <p className="text-xs text-[#9C9B99]">{dataError}</p>
            </div>
          </div>
        )}
        {!dataError && topoNodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-[#9C9B99]">Loading sessions...</p>
          </div>
        )}

        {/* 图例 */}
        <div className="absolute bottom-5 left-6 flex items-center gap-4">
          {[
            { color: '#C4A882', label: 'Main Session' },
            { color: '#B8956A', label: 'Active' },
            { color: '#A8C4A0', label: 'Leaf' },
            { color: '#D89575', label: 'Archived' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-[10px] font-medium text-[#9C9B99]">{label}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-0 border-t border-dashed border-[#D89575]" />
            <span className="text-[10px] font-medium text-[#9C9B99]">Cross-ref</span>
          </div>
        </div>

        {/* Tooltip */}
        {tooltip.visible && tooltip.node && (
          <div
            className="fixed z-50 pointer-events-none bg-[#2A2520]/95 backdrop-blur-sm rounded-lg border border-[#C4A88230] px-3 py-2 shadow-lg pop-enter"
            style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
          >
            <p className="text-xs font-semibold text-[#E5E4E1]">{tooltip.node.label}</p>
            <p className="text-[10px] text-[#9C9B99]">
              {tooltip.node.turns} turns · {tooltip.node.status}
            </p>
          </div>
        )}
      </div>

      {/* 右侧信息面板——CSS transition 平滑展开/收起 */}
      <div
        className="shrink-0 overflow-hidden transition-all duration-300 ease-out"
        style={{ width: panelOpen && selectedNode ? 288 : 0 }}
      >
        {selectedNode && (
          <div className="w-72 h-full bg-[#2A2520] border-l border-[#3D3530] flex flex-col p-5 gap-4">
            {/* 标题 + 关闭 */}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#F0EDE8]">
                {selectedNode.label}
              </h3>
              <button
                onClick={closePanel}
                className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-[#FFFFFF15] transition-colors"
              >
                <X size={14} className="text-[#A8A7A5]" />
              </button>
            </div>

            <div className="h-px bg-[#3D3530]" />

            {/* 属性行——提高亮度对比 */}
            {[
              { label: 'Status', value: selectedNode.status, color: selectedNode.status === 'active' ? '#C4793D' : '#A8A7A5' },
              { label: 'Turns', value: String(selectedNode.turns), color: '#F0EDE8' },
              { label: 'L2 Memory', value: 'Available', color: '#C4793D' },
              { label: 'Children', value: selectedNode.children.length > 0 ? `${selectedNode.children.length} (${selectedNode.children.join(', ')})` : 'None', color: '#F0EDE8' },
              { label: 'Last Active', value: '2 min ago', color: '#D1CEC8' },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#A8A7A5]">{label}</span>
                <span className="text-xs font-semibold" style={{ color }}>{value}</span>
              </div>
            ))}

            <div className="h-px bg-[#3D3530]" />

            {/* 跳转入口 */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-[#A8A7A5] tracking-wide">OPEN IN</p>
              <button
                onClick={() => navigate('/conversation')}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-[#FFFFFF08] hover:bg-[#FFFFFF15] transition-colors"
              >
                <MessageSquare size={14} className="text-primary" />
                <span className="text-xs font-medium text-[#F0EDE8]">Conversation</span>
              </button>
              <button
                onClick={() => navigate('/inspector')}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-[#FFFFFF08] hover:bg-[#FFFFFF15] transition-colors"
              >
                <Search size={14} className="text-primary" />
                <span className="text-xs font-medium text-[#F0EDE8]">Inspector</span>
              </button>
            </div>

            <div className="h-px bg-[#3D3530]" />

            {/* 操作按钮 */}
            <div className="flex gap-2">
              <button className="flex items-center gap-1.5 px-3 py-2 bg-primary/20 rounded-lg hover:bg-primary/30 transition-colors">
                <GitBranch size={13} className="text-primary" />
                <span className="text-xs font-medium text-primary">Fork</span>
              </button>
              <button className="flex items-center gap-1.5 px-3 py-2 bg-[#FFFFFF10] rounded-lg hover:bg-[#FFFFFF20] transition-colors">
                <Archive size={13} className="text-[#A8A7A5]" />
                <span className="text-xs font-medium text-[#A8A7A5]">Archive</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
