/**
 * 留学选校咨询 Demo 端到端测试
 *
 * 用法：确保 demo 已启动（npx tsx chat-devtools.ts），然后运行：
 *   npx tsx e2e-test.ts
 *
 * 测试链路：
 *   1. 主顾问对话 → LLM 自动 fork 子会话
 *   2. 子会话多轮对话 → 触发自动 consolidation → L2 生成
 *   3. 手动触发 integration → synthesis + insights 生成
 *   4. 验证 DevTools API 数据一致性
 */

const BASE = process.env.DEVTOOLS_URL ?? 'http://localhost:4800'
const API = `${BASE}/api`

// ─── HTTP 工具 ───

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`POST ${path} → ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

/** 发送消息并等待流式响应完成，返回最终内容 */
async function chat(sessionId: string, input: string): Promise<string> {
  await post(`/sessions/${sessionId}/enter`).catch(() => {})
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120_000)
  const res = await fetch(`${API}/sessions/${sessionId}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout))
  if (!res.ok || !res.body) {
    const fallback = await post<{ turn: { finalContent: string } }>(`/sessions/${sessionId}/turn`, { input })
    return fallback.turn.finalContent
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const chunk = JSON.parse(line)
        if (chunk.type === 'delta') content += chunk.delta ?? ''
        if (chunk.type === 'done') {
          content = chunk.result?.turn?.finalContent ?? chunk.result?.turn?.rawResponse ?? content
        }
      } catch { /* ignore */ }
    }
  }
  return content
}

// ─── 断言 ───

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ ${msg}`)
    passed++
  } else {
    console.log(`  ✗ ${msg}`)
    failed++
  }
}

function section(title: string) {
  console.log(`\n── ${title} ──`)
}

// ─── 测试流程 ───

async function run() {
  console.log(`\n留学选校 Demo E2E 测试`)
  console.log(`Target: ${BASE}\n`)

  // ─── Step 0: 检查服务可用 ───
  section('Step 0: 服务健康检查')
  const config = await get<Record<string, unknown>>('/config')
  assert(!!config, 'GET /config 响应正常')
  assert((config as any).scheduling?.hasScheduler === true, 'Scheduler 已启用')
  assert((config as any).splitGuard !== null, 'SplitGuard 已启用')

  const llm = await get<{ configured: boolean; model: string }>('/llm')
  assert(llm.configured, 'LLM Provider 已配置')
  console.log(`  (Model: ${llm.model})`)

  // ─── Step 1: 主顾问对话，触发自动 fork ───
  section('Step 1: 主顾问对话 → 自动 Fork')
  const { sessions: initialSessions } = await get<{ sessions: Array<{ id: string; label: string }> }>('/sessions')
  const mainSession = initialSessions[0]!
  console.log(`  主会话: ${mainSession.label} (${mainSession.id.slice(0, 8)})`)
  assert(initialSessions.length === 1, '初始只有 1 个主会话')

  console.log('  发送: 学生背景信息 + 目标美国和英国...')
  const reply1 = await chat(mainSession.id, '我想申请 CS 硕士，GPA 3.6/4.0（985），托福 105，GRE 325。考虑美国和英国，预算美国 60 万/年，英国 35 万/年。就业导向，偏好大城市。有 ACL workshop 论文和字节微软实习。')
  assert(reply1.length > 50, `主顾问回复长度合理 (${reply1.length} chars)`)

  // 等一下让 fork 事件处理完
  await sleep(2000)

  const { sessions: afterFork } = await get<{ sessions: Array<{ id: string; label: string; scope: string | null }> }>('/sessions')
  console.log(`  Fork 后会话数: ${afterFork.length}`)
  afterFork.forEach((s) => console.log(`    - ${s.label} (scope: ${s.scope ?? '—'})`))
  assert(afterFork.length >= 2, '至少 fork 出 1 个子会话（期望 2 个：美国+英国）')

  const usSession = afterFork.find((s) => s.label.includes('美国') || (s.scope ?? '').includes('美国'))
  const ukSession = afterFork.find((s) => s.label.includes('英国') || (s.scope ?? '').includes('英国'))

  // ─── Step 2: 美国子会话多轮对话 ───
  section('Step 2: 美国子会话 → 3 轮对话')
  if (usSession) {
    console.log(`  美国会话: ${usSession.label} (${usSession.id.slice(0, 8)})`)

    console.log('  轮 1: CMU vs UIUC vs Columbia 对比')
    await chat(usSession.id, '帮我对比 CMU MSCS、CMU MCDS、UIUC MCS 和 Columbia MSCS，从录取难度、学费、就业去向分析')

    console.log('  轮 2: CMU 细节')
    await chat(usSession.id, 'CMU 的 MCDS 和 MSCS 哪个更适合我？我有 NLP 论文想兼顾就业和研究')

    console.log('  轮 3: 申请策略')
    await chat(usSession.id, '给我一个美国选校的冲刺/稳妥/保底梯度方案，考虑我的背景')

    // 等 consolidation 完成（fire-and-forget，需要等 LLM 调用）
    console.log('  等待自动 consolidation...')
    await sleep(20000)

    const usDetail = await get<{ l2: string | null; records: unknown[] }>(`/sessions/${usSession.id}/detail`)
    console.log(`  Records: ${usDetail.records.length}, L2: ${usDetail.l2 ? usDetail.l2.slice(0, 60) + '...' : 'null'}`)
    assert(usDetail.records.length >= 6, `美国会话有 ${usDetail.records.length} 条记录`)
    assert(usDetail.l2 !== null, '美国会话 L2 已自动生成')
  } else {
    console.log('  ⚠ 未找到美国子会话，跳过')
  }

  // ─── Step 3: 英国子会话多轮对话 ───
  section('Step 3: 英国子会话 → 3 轮对话')
  if (ukSession) {
    console.log(`  英国会话: ${ukSession.label} (${ukSession.id.slice(0, 8)})`)

    console.log('  轮 1: 预算分析')
    await chat(ukSession.id, '35 万预算在伦敦读 CS 硕士够吗？帮我算 IC、UCL、Edinburgh 的学费和生活费')

    console.log('  轮 2: IC vs UCL')
    await chat(ukSession.id, 'IC Computing (AI/ML) 和 UCL CS 从就业角度哪个更值？')

    console.log('  轮 3: Edinburgh')
    await chat(ukSession.id, 'Edinburgh 远离伦敦，就业会不会受影响？苏格兰科技公司多吗？')

    console.log('  等待自动 consolidation...')
    await sleep(20000)

    const ukDetail = await get<{ l2: string | null; records: unknown[] }>(`/sessions/${ukSession.id}/detail`)
    console.log(`  Records: ${ukDetail.records.length}, L2: ${ukDetail.l2 ? ukDetail.l2.slice(0, 60) + '...' : 'null'}`)
    assert(ukDetail.records.length >= 6, `英国会话有 ${ukDetail.records.length} 条记录`)
    assert(ukDetail.l2 !== null, '英国会话 L2 已自动生成')
  } else {
    console.log('  ⚠ 未找到英国子会话，跳过')
  }

  // ─── Step 4: 手动触发 Integration ───
  section('Step 4: 手动触发 Integration')
  try {
    const intResult = await post<{ ok: boolean; synthesis: string; insightCount: number }>('/integrate')
    console.log(`  Synthesis: ${intResult.synthesis.slice(0, 80)}...`)
    console.log(`  Insights 推送: ${intResult.insightCount} 条`)
    assert(intResult.ok, 'Integration 调用成功')
    assert(intResult.synthesis.length > 50, `Synthesis 内容合理 (${intResult.synthesis.length} chars)`)
    assert(intResult.insightCount >= 0, `推送了 ${intResult.insightCount} 条 insights`)
  } catch (e) {
    console.log(`  ⚠ Integration 失败: ${e}`)
    assert(false, 'Integration 调用成功')
  }

  // ─── Step 5: 验证 DevTools API 一致性 ───
  section('Step 5: DevTools API 数据一致性')

  const tree = await get<{ id: string; children: unknown[] }>('/sessions/tree')
  assert(!!tree.id, 'Session tree 有根节点')
  assert((tree.children as unknown[]).length >= 1, `树有 ${(tree.children as unknown[]).length} 个子节点`)

  const events = await get<{ events: unknown[] }>('/events')
  assert(events.events.length > 0, `事件历史有 ${events.events.length} 条`)

  const tools = await get<{ configured: boolean; tools: unknown[] }>('/tools')
  assert(tools.configured, 'Tools provider 已配置')
  assert(tools.tools.length === 2, `有 ${tools.tools.length} 个 tools（create_session + save_note）`)

  const prompts = await get<{ configured: boolean }>('/prompts')
  assert(prompts.configured, 'Prompts provider 已配置')

  // ─── 结果 ───
  section('结果')
  console.log(`\n  通过: ${passed}  失败: ${failed}  总计: ${passed + failed}\n`)

  if (failed > 0) {
    process.exit(1)
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

run().catch((e) => {
  console.error('\n测试异常退出:', e)
  process.exit(1)
})
