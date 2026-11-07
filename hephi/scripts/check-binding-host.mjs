#!/usr/bin/env node
// ROADMAP-95 A2：完整证据链宿主探针（只读、脱敏）。
//
// 目标：核实 A1 绑定的五个环节在真实宿主编码下是否成立：
//   H1 hephi_check 内部 bash 调用是否出现在当前 Worker Session 快照；tool/call 字段名、
//      arguments 形态（原始 JSON 字符串）、workdir 字段；
//   H2 前台 bash 结果的 kind / exitCode 位置；promoted 结果是否带 jobId 且无最终退出码；
//   H3 ready 时 jobs.get(jobId, sessionId) 能否取到已完成 Job 终态与 detail；错误 session
//      调用的行为（抛错/undefined）；readAt 的 lossy 语义；
//   H4 check 记录写入的 sessionId（outer.agent.id）与 ready 时 session.header.id 是否相等；
//   H5 Session 前台 stdout/stderr 是否完整（truncated 标记）；完成后 Job 输出是否可读、
//      lossy 何时为真；
//   H6 Worker 能否通过工具影响自己的 Session 快照（提供操作步骤与判定标准）。
//
// 用法（详见 --help）：
//   node hephi/scripts/check-binding-host.mjs --help
//   node hephi/scripts/check-binding-host.mjs                       # 无上下文 → 全 unavailable/manual，exit 2
//   node hephi/scripts/check-binding-host.mjs --session <session.v4.jsonl.zstd> \
//        --check-record <state/hephi/<ticket>/checks/<runId>/run.json> [--host http://127.0.0.1:3083]
//   node hephi/scripts/check-binding-host.mjs --self-test
//
// 退出码：全部 pass=0；有 fail=1；只有 unavailable/manual=2。
// 本脚本只读文件、只做一次 GET /orchestrator/api/state；不修改宿主、不写仓库、不新增依赖。
// 说明：这不是端到端验收。夹具/快照结论 ≠ 真实宿主 A1-BIND 端到端通过。
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const USAGE = `ROADMAP-95 A2 证据链宿主探针（只读、脱敏）

用法：
  node hephi/scripts/check-binding-host.mjs --help
  node hephi/scripts/check-binding-host.mjs [选项]

选项：
  --session <file>         Worker Session 持久化文件（session.vN.jsonl.zstd 或 .jsonl/.json）
                           可在宿主 state dir 下查找：find <dsh-home>/sessions -name 'session.v*.jsonl.zstd'
  --check-record <file>    hephi 检查记录 run.json（state/hephi/<ticket>/checks/<runId>/run.json）
  --host <url>             只读 GET /orchestrator/api/state（默认不访问网络；缺省跳过）
  --manual <spec>          操作者对无法自动探测环节的人工结论，如 H3=pass,H5=pass,H6=fail
                           只接受 H3/H4/H5/H6，值 pass|fail|manual；结果写入报告并参与退出码。
                           人工结论必须附证据（宿主内命令 + 输出），不得无证据回填。
  --out <file>             额外写出脱敏 JSON 报告（默认只打印）
  --json                   只输出 JSON（人类摘要仍写 stderr）
  --no-redact              不脱敏（仅限操作者本机私有排查；报告不得分享）
  --self-test              用合成数据自测解析/判定逻辑（不访问真实宿主）
  --help                   显示本帮助

无宿主上下文（无 --session/--check-record/--host）时：
  H1–H6 全部输出 unavailable/manual，退出码 2，并打印操作者在宿主上需要执行的命令。

在宿主上的推荐流程：
  1) 找最近一次 Worker Session 快照（见上）与其 check 记录；
  2) 运行本脚本：node hephi/scripts/check-binding-host.mjs --session <f> --check-record <r> --out /tmp/h1h2h4.json
  3) 按输出中的 manual 步骤在宿主内完成 H3/H5/H6，再用 --manual 回填结论复跑一次；
  4) 把脱敏 JSON、命令与 H1–H6 结论填入 hephi/docs/validation/2026-11-07-evidence-chain-host.md。

限制：本脚本读取的是宿主持久化快照（JSONL+zstd），不是实时 ctx 服务；Job 注册表
（jobs.get/readAt/lossy）与 Worker 自影响（H6）必须在宿主内人工探测。快照结论 ≠ 端到端。
`

const MANUAL_STEPS = {
  H3: [
    '在宿主内（有 ctx.jobs 的进程/测试插件中）对一个已完成的 check Job 执行：',
    "  view = ctx.jobs.get(record.jobId, record.sessionId)  // 期望 JobView{status:'completed', detail:'exit code: <n>'}",
    '  wrong = () => ctx.jobs.get(record.jobId, <另一个 session id>)  // 记录实际行为：抛错还是 undefined',
    "  read = ctx.jobs.readAt(record.jobId, 0, record.sessionId)  // 记录 chunks/lossy；构造超过 ring 保留窗口的输出触发 lossy=true",
    '判定：能在本 Session 取到终态与 detail、错误 Session 被拒绝（抛错或 undefined 且调用方按失败处理）、lossy 语义明确 → pass；否则 fail。',
    '注意：dsh-jobs 的类型契约写的是“unknown/foreign job 抛错”，但本脚本不能替宿主实测。',
  ],
  H4: [
    '采集（只读）：取 run.json 的 sessionId 与 Session 快照头的 id；',
    "  node -e \"const r=require('<run.json>'); console.log('record sessionId', r.sessionId)\"",
    "  node -e \"const z=require('node:zlib'),fs=require('node:fs'); const b=fs.readFileSync('<session.vN.jsonl.zstd>');/* 按 magic 切帧后取第一条 session 事件 */ console.log(b.subarray(0,4).toString('hex'))\"",
    '更简单：直接用本脚本 --session <快照> --check-record <run.json>，H4 会自动比较 record.sessionId 与 session.header.id；',
    '判定：两者相等 → pass；不等 → fail（A1 计划要求改为写 session.header.id 并升记录格式版本）。',
  ],
  H5: [
    '前台：在 Worker 里跑一条输出超过 stream cap 的 bash，检查 tool/result 是否出现 “[output truncated” 与 spill 路径；',
    '后台：让 check 提升为 Job（长命令），用 ctx.jobs.readAt(jobId, 0, sessionId) 读取：记录 lossy 是否为 true、chunks 是否完整、spillPaths 是否存在；',
    '判定：前台截断有明确标记且 spill 可读、Job 输出可完整读取且 lossy 语义与文档一致 → pass；否则 fail。',
  ],
  H6: [
    '只能在一次性/可销毁的宿主实例上做，禁止在生产实例操作。',
    '步骤：在一个真实 Worker run 中，用 bash/write 工具尝试影响自己的 Session 快照或检查记录：',
    '  a) 读取并尝试追加/改写 <dsh-home>/sessions/**/session.v*.jsonl.zstd；',
    '  b) 尝试改写 state/hephi/<ticket>/checks/<runId>/run.json；',
    '  c) 尝试通过工具调用伪造与 check 同 callId 的事件。',
    '判定：Worker 无法让快照/记录出现未发生的可信事件 → pass；任一成功（或 ready 采信被篡改内容）→ fail，',
    '此时按计划审查 P1-7：A1-BIND 停止，保底只保留 A1-OUT + 文件指纹 + A4 威胁模型，并把 D1 的上限降为 L1/L2。',
  ],
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const next = process.argv[i + 1]
  return next === undefined || next.startsWith('--') ? fallback : next
}

function maskId(value) {
  const text = String(value ?? '')
  if (text.length <= 14) return text
  return `${text.slice(0, 6)}…${text.slice(-4)}`
}

function redactor(enabled) {
  if (!enabled) return (value) => String(value ?? '')
  const home = homedir()
  return (value) => String(value ?? '')
    .replaceAll(home, '$HOME')
    .replace(/\/Users\/[^/\s]+/g, '$HOME')
    .replace(/\b(worker|orchestrator|session)-[0-9a-f]{8,}\b/gi, (match) => maskId(match))
    .replace(/\b(call|bash|job)_[A-Za-z0-9_-]{8,}\b/g, (match) => maskId(match))
    .replace(/(authorization|token|secret|password|api[_-]?key)(\s*[:=]\s*)\S+/gi, '$1$2***')
}

function ring(id, status, evidence, notes) {
  return { id, status, evidence: evidence ?? null, notes: notes ?? null }
}

function quote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`
}

function expectedCheckCommand(record) {
  if (!record || !Array.isArray(record.argv) || record.argv.length === 0) return null
  const base = record.before?.baseCommit
  if (typeof base !== 'string' || base.length === 0) return null
  return `HEPHI_BASE_COMMIT=${quote(base)} ` + record.argv.map(quote).join(' ')
}

function exitCodeFromDetail(detail) {
  if (typeof detail !== 'string') return null
  const match = /^exit code: (-?\d+)(?:;|$)/.exec(detail)
  return match ? Number(match[1]) : null
}

// ---- Session 快照解析 -------------------------------------------------------

function decompressZstdFrames(buffer) {
  // zstdDecompressSync 只解第一帧；JSONL 快照是每行/每事件一帧，需按 magic 切分。
  const zstd = requireZstd()
  const positions = []
  let cursor = 0
  while ((cursor = buffer.indexOf(ZSTD_MAGIC, cursor)) !== -1) {
    positions.push(cursor)
    cursor += ZSTD_MAGIC.length
  }
  const texts = []
  for (let i = 0; i < positions.length; i += 1) {
    const start = positions[i]
    const end = i + 1 < positions.length ? positions[i + 1] : buffer.length
    texts.push(zstd.zstdDecompressSync(buffer.subarray(start, end)).toString('utf8'))
  }
  // 每帧是一条 JSONL 记录；用换行拼接，避免无结尾换行的帧把两条记录粘在一起。
  return texts.join('\n')
}

function requireZstd() {
  // Node >= 22.15 才有 zstd；旧 Node 给出清晰错误而不是崩栈。
  const zlib = process.getBuiltinModule('node:zlib')
  if (typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error('当前 Node 不支持 zstd（需要 Node >= 22.15）；请用宿主同版本 Node 运行')
  }
  return zlib
}

function parseEventsText(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  const events = []
  const problems = []
  let wrapper = null
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line)
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.events)) {
        wrapper = parsed
        events.push(...parsed.events)
      } else if (Array.isArray(parsed)) {
        events.push(...parsed)
      } else {
        events.push(parsed)
      }
    } catch (error) {
      problems.push(`无法解析一行事件：${error.message}`)
    }
  }
  return { events, problems, wrapper }
}

function readSessionSnapshot(file) {
  const buffer = readFileSync(file)
  let format = 'jsonl'
  let text
  if (buffer.subarray(0, 4).equals(ZSTD_MAGIC)) {
    format = 'jsonl.zstd'
    text = decompressZstdFrames(buffer)
  } else {
    text = buffer.toString('utf8')
  }
  const { events, problems, wrapper } = parseEventsText(text)
  const headerEvent = events.find((event) => event && event.type === 'session')
  const header = headerEvent?.data ?? headerEvent ?? wrapper?.session ?? null
  const inheritedEventCount = typeof wrapper?.inheritedEventCount === 'number' ? wrapper.inheritedEventCount : 0
  const headerId = header?.id ?? header?.session?.id ?? null
  return { format, events, header, headerId, inheritedEventCount, problems, bytes: buffer.length }
}

// ---- 各环节分析 -------------------------------------------------------------

function analyzeSession(session) {
  const events = session.events.filter((event) => event && typeof event === 'object')
  const calls = events.filter((event) => event.type === 'tool/call' && event.data)
  const results = events.filter((event) => event.type === 'tool/result' && event.data?.message)
  const jobs = events.filter((event) => event.type === 'job/registered' && event.data)
  const settled = events.filter((event) => event.type === 'job/settled' && event.data)
  const callById = new Map(calls.map((event) => [event.data.callId, event.data]))
  const resultByCallId = new Map(results.map((event) => [event.data.message.toolCallId, event.data.message]))
  const settledByJobId = new Map(settled.map((event) => [event.data.jobId, event.data]))
  const internalJobs = jobs.filter((event) => {
    const toolCall = event.data.toolCall
    return toolCall && typeof toolCall.callId === 'string' && typeof toolCall.rootCallId === 'string' && toolCall.callId !== toolCall.rootCallId
  })
  const bashCalls = calls.filter((event) => event.data.name === 'bash')
  const bashResults = results.filter((event) => callById.get(event.data.message.toolCallId)?.name === 'bash')
  return { events, calls, results, jobs, settled, callById, resultByCallId, settledByJobId, internalJobs, bashCalls, bashResults }
}

function parseArguments(value) {
  if (value && typeof value === 'object') return { parsed: value, rawType: 'object' }
  if (typeof value !== 'string') return { parsed: null, rawType: typeof value }
  try {
    return { parsed: JSON.parse(value), rawType: 'string' }
  } catch {
    return { parsed: null, rawType: 'string', parseError: true }
  }
}

function h1Ring(sessionAnalysis, record, redact) {
  if (!sessionAnalysis) {
    return ring('H1', 'unavailable', null, '没有 Session 快照：需要一次真实 Worker 运行；见 --help 与 manualSteps。')
  }
  const evidence = {
    toolCallCount: sessionAnalysis.calls.length,
    toolResultCount: sessionAnalysis.results.length,
    internalJobCount: sessionAnalysis.internalJobs.length,
    internalJobSamples: sessionAnalysis.internalJobs.slice(0, 3).map((event) => ({
      jobId: maskId(event.data.jobId),
      callId: maskId(event.data.toolCall?.callId),
      rootCallId: maskId(event.data.toolCall?.rootCallId),
      rootTool: redact(sessionAnalysis.callById.get(event.data.toolCall?.rootCallId)?.name ?? '(root tool/call 不在本 Session 快照中)'),
      label: redact(event.data.label).slice(0, 200),
    })),
    argumentsType: sessionAnalysis.bashCalls.length > 0
      ? [...new Set(sessionAnalysis.bashCalls.map((event) => (typeof event.data.arguments === 'string' ? 'string' : typeof event.data.arguments)))]
      : [],
    workdirFieldPresent: sessionAnalysis.bashCalls.filter((event) => parseArguments(event.data.arguments).parsed
      && Object.prototype.hasOwnProperty.call(parseArguments(event.data.arguments).parsed, 'workdir')).length,
  }
  if (record) {
    const expected = expectedCheckCommand(record)
    const inner = record.innerCallId
    const call = inner ? sessionAnalysis.callById.get(inner) : undefined
    const result = inner ? sessionAnalysis.resultByCallId.get(inner) : undefined
    const args = call ? parseArguments(call.arguments) : { parsed: null }
    evidence.record = {
      version: record.version ?? null,
      sessionId: redact(record.sessionId ?? ''),
      callId: maskId(record.callId),
      innerCallId: maskId(inner),
      expectedCommand: redact(expected ?? '(record 缺 argv/before.baseCommit，无法重建期望命令)').slice(0, 300),
      jobId: record.jobId ? maskId(record.jobId) : null,
    }
    evidence.inner = {
      toolCallFound: Boolean(call),
      toolCallName: call?.name ?? null,
      toolResultFound: Boolean(result),
      argumentsRawType: call ? (typeof call.arguments === 'string' ? 'string' : typeof call.arguments) : null,
      parsedKeys: args.parsed ? Object.keys(args.parsed) : [],
      commandMatches: Boolean(args.parsed && expected && args.parsed.command === expected),
      workdir: args.parsed && Object.prototype.hasOwnProperty.call(args.parsed, 'workdir') ? redact(args.parsed.workdir) : '(缺少 workdir 字段)',
      workdirMatchesRecordCwd: Boolean(args.parsed && record.cwd && args.parsed.workdir === record.cwd),
    }
    const ok = evidence.inner.toolCallFound && evidence.inner.toolCallName === 'bash'
      && evidence.inner.commandMatches && evidence.inner.workdirMatchesRecordCwd
    return ring('H1', ok ? 'pass' : 'fail', evidence, ok
      ? 'Session 快照中存在与记录匹配的内部 bash tool/call（命令与 workdir 逐字符一致）。'
      : '内部 bash 调用未按 A1 期望出现：需要 tool/call(callId=innerCallId)、name=bash、arguments.command 与 workdir 精确匹配。注意嵌套 tools.execute 可能不产生 tool/call 事件（见 H5/历史验证文档）。')
  }
  // 没有记录时，只能用内部 dispatcher 的 Job 事件推断编码；不能判定绑定是否成立。
  if (sessionAnalysis.internalJobs.length === 0) {
    return ring('H1', 'unavailable', evidence, '快照中没有 hephi_check 内部 dispatch 的 Job 事件；无法判断内部 bash 调用编码。请提供 --check-record。')
  }
  const missingCalls = sessionAnalysis.internalJobs.filter((event) => !sessionAnalysis.callById.has(event.data.toolCall.callId))
  return ring('H1', missingCalls.length === 0 ? 'pass' : 'fail', {
    ...evidence,
    internalJobsWithoutToolCall: missingCalls.length,
  }, missingCalls.length === 0
    ? '所有内部 dispatch 都能在 Session 快照中找到 tool/call。'
    : '存在内部 Job 事件，但其 callId 在 Session 快照中没有对应 tool/call 事件（嵌套 dispatch 不产生 Session 事件）。')
}

function textOfMessage(message) {
  const content = Array.isArray(message?.content) ? message.content : []
  return content.map((part) => (part && typeof part.text === 'string' ? part.text : '')).join('\n')
}

function h2Ring(sessionAnalysis, redact) {
  if (!sessionAnalysis) return ring('H2', 'unavailable', null, '没有 Session 快照；无法核对前台结果编码。')
  if (sessionAnalysis.bashResults.length === 0) {
    return ring('H2', 'unavailable', { bashCallCount: sessionAnalysis.bashCalls.length }, '快照中没有 bash tool/result；无法核对。')
  }
  const samples = sessionAnalysis.bashResults.slice(0, 5).map((event) => {
    const message = event.data.message
    const text = textOfMessage(message)
    const value = message.value
    return {
      callId: maskId(message.toolCallId),
      isError: message.isError ?? null,
      hasStructuredValue: Boolean(value && typeof value === 'object' && typeof value.kind === 'string'),
      kind: value?.kind ?? null,
      exitCodeField: value?.exitCode ?? null,
      textExitCodeMarker: /\[exit code: -?\d+\]/.exec(text)?.[0] ?? null,
      promotedMarker: /\[still running after \d+ms; moved to background job [^\]]+\]/.exec(text)?.[0] ?? null,
      truncatedMarker: text.includes('[output truncated') ? '[output truncated' : null,
      contentChars: text.length,
    }
  })
  const structured = samples.filter((sample) => sample.hasStructuredValue).length
  const evidence = {
    bashResultCount: sessionAnalysis.bashResults.length,
    structuredValueCount: structured,
    kinds: [...new Set(samples.map((sample) => sample.kind).filter(Boolean))],
    samples,
  }
  if (structured === 0) {
    return ring('H2', 'fail', evidence, '持久化 tool/result 的 message 不含结构化 value（kind/exitCode 读不到）；A1 期望的 message.value 在本快照编码下不存在。退出码只以文本标记 [exit code: N] 出现。')
  }
  if (structured < sessionAnalysis.bashResults.length) {
    return ring('H2', 'fail', evidence, `只有 ${structured}/${sessionAnalysis.bashResults.length} 条 bash tool/result 带结构化 value；编码不统一。`)
  }
  return ring('H2', 'pass', evidence, 'tool/result 携带结构化 value（kind/exitCode/jobId 可读）。')
}

function h3Ring(sessionAnalysis, redact) {
  if (!sessionAnalysis) return ring('H3', 'unavailable', null, '没有 Session 快照；Job 终态需在宿主内探测。manualSteps.H3 给出步骤。')
  const forms = sessionAnalysis.settled.slice(0, 20).map((event) => ({
    jobId: maskId(event.data.jobId),
    status: event.data.status,
    cause: event.data.cause,
    detail: redact(event.data.detail ?? '').slice(0, 120),
    detailExitCode: exitCodeFromDetail(event.data.detail),
    finishedAt: event.data.finishedAt ?? null,
  }))
  return ring('H3', 'manual', {
    jobRegisteredCount: sessionAnalysis.jobs.length,
    jobSettledCount: sessionAnalysis.settled.length,
    settledSamples: forms.slice(0, 5),
    detailExitCodeFormCount: forms.filter((form) => form.detailExitCode !== null).length,
    note: 'Session 事件证明 Job 终态（status/detail）会随会话持久化；但 jobs.get/readAt 的实时行为（含错误 session 拒绝与 lossy）必须在宿主进程内实测。',
  }, 'manualSteps.H3：在宿主内用 ctx.jobs.get/readAt 实测终态、错误 Session 行为与 lossy；类型契约声称 foreign job 抛错，但需实测确认。')
}

function h4Ring(session, record, redact) {
  if (!session || !record) {
    return ring('H4', 'unavailable', {
      hasSession: Boolean(session), hasRecord: Boolean(record),
      recordSessionId: record ? redact(record.sessionId ?? '') : null,
      sessionHeaderId: session ? redact(session.headerId ?? '') : null,
    }, 'H4 需要同时提供 --session 与 --check-record；也可按 manualSteps.H4 手动采集。')
  }
  const recordSessionId = record.sessionId ?? null
  const headerId = session.headerId ?? null
  const evidence = {
    recordVersion: record.version ?? null,
    recordSessionId: redact(recordSessionId ?? ''),
    sessionHeaderId: redact(headerId ?? ''),
    equal: Boolean(recordSessionId) && Boolean(headerId) && recordSessionId === headerId,
    recordHasAgentField: Boolean(record.agent),
    note: 'run.json 的 sessionId 由 check-runner 写入 outer.agent.id；H4 要确认它等于 session.header.id。',
  }
  if (!recordSessionId || !headerId) {
    return ring('H4', 'unavailable', evidence, '记录或快照缺少 id 字段；见 manualSteps.H4。')
  }
  return ring('H4', evidence.equal ? 'pass' : 'fail', evidence, evidence.equal
    ? '记录写入的 sessionId 与 Session 头 id 相等。'
    : '记录写入的 sessionId 与 Session 头 id 不相等：按 A1 计划需改为写 session.header.id 并升记录格式版本。')
}

function h5Ring(sessionAnalysis, redact) {
  if (!sessionAnalysis) return ring('H5', 'unavailable', null, '没有 Session 快照；前台/Job 输出完整性需在宿主内探测。')
  const truncated = sessionAnalysis.bashResults.filter((event) => textOfMessage(event.data.message).includes('[output truncated'))
  const samples = sessionAnalysis.bashResults.slice(0, 5).map((event) => {
    const message = event.data.message
    const text = textOfMessage(message)
    return {
      callId: maskId(message.toolCallId),
      chars: text.length,
      truncatedMarker: /\[output truncated[^\]]*\]/.exec(text)?.[0] ?? null,
      spillPathMarker: /full output: ([^\]]+)\]/.exec(text)?.[1] ?? null,
    }
  })
  return ring('H5', 'manual', {
    bashResultCount: sessionAnalysis.bashResults.length,
    truncatedResultCount: truncated.length,
    samples,
    note: '前台 truncated 标记可从快照核对；Job 输出可读性与 readAt.lossy 需要宿主进程内探测（manualSteps.H5）。',
  }, 'manualSteps.H5：在宿主内构造超长/提升为 Job 的命令，实测 truncation、spill、Job readAt 与 lossy。')
}

function h6Ring() {
  return ring('H6', 'manual', { note: '需要真实 Worker 在可销毁实例上进行自影响尝试。' }, 'manualSteps.H6：Worker 尝试改写 Session 快照/检查记录/伪造 callId；任一生效即 fail，并按 P1-7 回退 A1-BIND。')
}

// ---- 宿主状态（只读） -------------------------------------------------------

async function readHostState(url) {
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/orchestrator/api/state`, {
      headers: { 'x-orchestrator-request': '1' },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }
    const state = await response.json()
    return {
      ok: true,
      paused: state.paused ?? null,
      load: state.load ?? null,
      runtime: state.health?.runtime?.state ?? null,
      health: Object.fromEntries(Object.entries(state.health ?? {}).map(([key, value]) => [key, value?.state ?? null])),
      masterId: maskId(state.masterId ?? ''),
      hasSetup: Boolean(state.setup),
    }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

// ---- 报告 -------------------------------------------------------------------

function manualOverride(spec) {
  const map = {}
  if (!spec) return map
  for (const part of String(spec).split(',')) {
    const [id, status] = part.split('=').map((item) => item.trim())
    if (!id || !status) continue
    if (!['H3', 'H4', 'H5', 'H6'].includes(id)) continue
    if (!['pass', 'fail', 'manual'].includes(status)) continue
    map[id] = status
  }
  return map
}

function summarize(rings) {
  const counts = { pass: 0, fail: 0, unavailable: 0, manual: 0 }
  for (const item of rings) counts[item.status] += 1
  const exitCode = counts.fail > 0 ? 1 : (counts.pass === rings.length ? 0 : 2)
  return { counts, exitCode }
}

async function probe(options) {
  const redact = redactor(!options.noRedact)
  const rings = []
  const operatorCommands = []
  let session = null
  let record = null
  let sessionError = null
  let recordError = null

  if (options.session) {
    try {
      session = readSessionSnapshot(resolve(options.session))
      if (session.problems.length > 0) sessionError = session.problems.slice(0, 3).join('; ')
    } catch (error) {
      sessionError = error.message
    }
  }
  if (options.checkRecord) {
    try {
      record = JSON.parse(readFileSync(resolve(options.checkRecord), 'utf8'))
    } catch (error) {
      recordError = error.message
    }
  }
  const host = options.host ? await readHostState(options.host) : null
  const analysis = session ? analyzeSession(session) : null
  const overrides = manualOverride(options.manual)

  const baseRings = [
    h1Ring(analysis, record, redact),
    h2Ring(analysis, redact),
    h3Ring(analysis, redact),
    h4Ring(session, record, redact),
    h5Ring(analysis, redact),
    h6Ring(),
  ]
  for (const item of baseRings) {
    if (overrides[item.id] && overrides[item.id] !== item.status) {
      rings.push({ ...item, status: overrides[item.id], notes: `${item.notes ?? ''}（操作者人工结论：${overrides[item.id]}）` })
    } else {
      rings.push(item)
    }
  }

  if (session) {
    operatorCommands.push(
      `# 已在本地解析 Session 快照（只读）：${options.session}`,
      `# 复核内部 dispatch 的 Job 事件：在脱敏 JSON 中查看 rings[H1].evidence.internalJobSamples`,
    )
  } else {
    operatorCommands.push(
      "# 1) 找最近一次 Worker Session 快照（只读）：",
      "find <dsh-home>/sessions -name 'session.v*.jsonl.zstd' -print0 | xargs -0 ls -t | head -5",
      "# 2) 找对应的 check 记录（只读）：",
      'find <state>/hephi -path "*/checks/*/run.json" -print0 | xargs -0 ls -t | head -5',
      '# 3) 运行探针（只读）：',
      'node hephi/scripts/check-binding-host.mjs --session <session.v4.jsonl.zstd> --check-record <run.json> --host http://127.0.0.1:3083 --out /tmp/h1h2h4.json',
      '# 4) 按 manualSteps 在宿主内完成 H3/H5/H6，再回填：',
      'node hephi/scripts/check-binding-host.mjs --session <f> --check-record <r> --manual H3=pass,H5=pass,H6=pass --out /tmp/evidence-chain.json',
    )
  }
  operatorCommands.push(...(MANUAL_STEPS.H3.map((line) => `# H3 ${line}`)))
  operatorCommands.push(...(MANUAL_STEPS.H4.map((line) => `# H4 ${line}`)))
  operatorCommands.push(...(MANUAL_STEPS.H5.map((line) => `# H5 ${line}`)))
  operatorCommands.push(...(MANUAL_STEPS.H6.map((line) => `# H6 ${line}`)))

  const summary = summarize(rings)
  return {
    probe: 'ROADMAP-95 A2 evidence-chain host probe',
    generatedAt: new Date().toISOString(),
    mode: options.session || options.checkRecord || options.host ? 'host-evidence' : 'no-host-context',
    redaction: !options.noRedact,
    inputs: {
      session: options.session ? redact(resolve(options.session)) : null,
      sessionFormat: session?.format ?? null,
      sessionBytes: session?.bytes ?? null,
      sessionEventCount: session?.events.length ?? null,
      sessionHeaderId: session ? redact(session.headerId ?? '') : null,
      sessionParseError: sessionError,
      checkRecord: options.checkRecord ? redact(resolve(options.checkRecord)) : null,
      checkRecordError: recordError,
      host: host ? { url: redact(options.host), ...host } : null,
    },
    rings,
    summary,
    exitCode: summary.exitCode,
    manualSteps: MANUAL_STEPS,
    operatorCommands,
    limitations: [
      '本脚本不进入宿主 Cordis 进程：jobs.get/readAt/lossy 与 H6 自影响只能由操作者在宿主内人工探测。',
      '读取的是持久化 Session 快照（JSONL+zstd），不是实时 ctx 服务；快照结论 ≠ 端到端验收。',
      '夹具/快照通过 ≠ A1-BIND 真实宿主端到端通过；最终结论以 hephi/docs/validation/2026-11-07-evidence-chain-host.md 记录为准。',
      'Worker 可写 workspace；H6 只能在一次性/可销毁宿主实例上尝试。',
    ],
  }
}

function printHuman(report) {
  const lines = []
  lines.push(`[check-binding-host] ${report.probe}`)
  lines.push(`[check-binding-host] mode=${report.mode} redaction=${report.redaction}`)
  if (report.inputs.session) lines.push(`[check-binding-host] session=${report.inputs.session} (${report.inputs.sessionFormat}, ${report.inputs.sessionEventCount} events)`)
  if (report.inputs.sessionParseError) lines.push(`[check-binding-host] session parse warning: ${report.inputs.sessionParseError}`)
  if (report.inputs.checkRecord) lines.push(`[check-binding-host] check-record=${report.inputs.checkRecord}`)
  if (report.inputs.host) lines.push(`[check-binding-host] host=${report.inputs.host.url} readable=${report.inputs.host.ok}`)
  for (const item of report.rings) {
    lines.push(`${item.id} ${item.status.toUpperCase()} :: ${item.notes ?? ''}`)
    for (const line of JSON.stringify(item.evidence ?? {}, null, 2).split('\n').slice(0, 30)) {
      lines.push(`    ${line}`)
    }
  }
  const { pass, fail, unavailable, manual } = report.summary.counts
  lines.push(`SUMMARY pass=${pass} fail=${fail} unavailable=${unavailable} manual=${manual}`)
  lines.push(`RESULT: ${report.exitCode === 0 ? 'PASS' : report.exitCode === 1 ? 'FAIL' : 'INCOMPLETE（unavailable/manual，需宿主操作者补证据）'}`)
  if (report.mode === 'no-host-context') {
    lines.push('')
    lines.push('在宿主上执行的命令：')
    for (const command of report.operatorCommands) lines.push(`  ${command}`)
  }
  console.log(lines.join('\n'))
}

// ---- 自测 -------------------------------------------------------------------

function selfTest(asJson) {
  const steps = []
  const record = (name, ok, detail) => steps.push({ name, ok: Boolean(ok), detail })
  const rootCallId = 'call_root_self_test_0001'
  const innerCallId = 'hephi-self-test-inner-0001'
  const sessionId = 'worker-self-test-000000000001'
  const command = `HEPHI_BASE_COMMIT=${quote('a'.repeat(40))} 'bash' 'scripts/check.sh'`
  const cwd = '/tmp/self-test-workspace'
  const baseRecord = {
    version: 3,
    runId: 'run-self-test',
    sessionId,
    callId: rootCallId,
    innerCallId,
    argv: ['bash', 'scripts/check.sh'],
    cwd,
    before: { baseCommit: 'a'.repeat(40) },
    status: 'passed',
    exitCode: 0,
  }
  const makeSession = (withInnerCall, withValue) => ({
    headerId: sessionId,
    events: [
      { type: 'session', data: { type: 'session', version: 4, id: sessionId } },
      { type: 'tool/call', data: { callId: rootCallId, name: 'hephi_check', arguments: '{"checkId":"project-regression"}' } },
      { type: 'job/registered', data: { jobId: 'bash-self-test-0001', owner: sessionId, kind: 'bash', label: command, toolCall: { callId: innerCallId, rootCallId } } },
      ...(withInnerCall
        ? [
            { type: 'tool/call', data: { callId: innerCallId, name: 'bash', arguments: JSON.stringify({ command, workdir: cwd }) } },
            { type: 'tool/result', data: { message: { role: 'tool', toolCallId: innerCallId, isError: false, content: [{ type: 'text', text: '[exit code: 0]' }], ...(withValue ? { value: { kind: 'foreground', exitCode: 0, timedOut: false, aborted: false, stdout: { text: 'ok', truncated: false }, stderr: { text: '', truncated: false } } } : {}) } } },
          ]
        : []),
      { type: 'job/settled', data: { jobId: 'bash-self-test-0001', owner: sessionId, kind: 'bash', label: command, toolCall: { callId: innerCallId, rootCallId }, status: 'completed', cause: 'producer', producerReported: true, detail: 'exit code: 0' } },
      { type: 'tool/result', data: { message: { role: 'tool', toolCallId: rootCallId, isError: false, content: [{ type: 'text', text: '{"status":"passed"}' }] } } },
    ],
  })
  const redact = redactor(true)
  const session = makeSession(true, true)
  const analysis = analyzeSession(session)
  const h1 = h1Ring(analysis, baseRecord, redact)
  const h2 = h2Ring(analysis, redact)
  const h4 = h4Ring(session, baseRecord, redact)
  record('合成快照：H1 pass（内部 tool/call 匹配命令与 workdir）', h1.status === 'pass', JSON.stringify(h1.evidence?.inner))
  record('合成快照：H2 pass（结构化 value 可读）', h2.status === 'pass', JSON.stringify(h2.evidence))
  record('合成快照：H4 pass（sessionId 相等）', h4.status === 'pass', JSON.stringify(h4.evidence))

  const noInner = analyzeSession(makeSession(false, false))
  const h1Missing = h1Ring(noInner, baseRecord, redact)
  record('负例：内部 tool/call 缺失 → H1 fail', h1Missing.status === 'fail', h1Missing.notes)
  const noValue = analyzeSession(makeSession(true, false))
  record('负例：tool/result 无结构化 value → H2 fail', h2Ring(noValue, redact).status === 'fail', 'ok')
  const mismatchRecord = { ...baseRecord, sessionId: 'worker-other-000000000002' }
  record('负例：sessionId 不一致 → H4 fail', h4Ring(session, mismatchRecord, redact).status === 'fail', 'ok')

  // 无上下文整体判定：应全 unavailable/manual 且 exit 2。
  const noContext = summarize([
    ring('H1', 'unavailable'), ring('H2', 'unavailable'), ring('H3', 'manual'),
    ring('H4', 'unavailable'), ring('H5', 'unavailable'), ring('H6', 'manual'),
  ])
  record('无宿主上下文：只有 unavailable/manual → exit 2', noContext.exitCode === 2, JSON.stringify(noContext))

  // zstd 多帧解析（Node>=22.15）。
  try {
    const zlib = requireZstd()
    const frames = [Buffer.from(JSON.stringify({ type: 'session', data: { id: sessionId } })), Buffer.from(JSON.stringify({ type: 'tool/call', data: { callId: rootCallId, name: 'hephi_check', arguments: '{}' } }))]
    const zstdPath = resolve('/tmp', `check-binding-host-self-${process.pid}.jsonl.zstd`)
    writeFileSync(zstdPath, Buffer.concat(frames.map((frame) => zlib.zstdCompressSync(frame))))
    const parsed = readSessionSnapshot(zstdPath)
    unlinkSync(zstdPath)
    record('zstd 多帧 Session 快照解析（2 frames → 2 events）', parsed.events.length === 2 && parsed.headerId === sessionId, `events=${parsed.events.length}`)
  } catch (error) {
    record('zstd 多帧 Session 快照解析', false, error.message)
  }

  const ok = steps.every((step) => step.ok)
  if (asJson) console.log(JSON.stringify({ selfTest: ok, steps }, null, 2))
  else {
    for (const step of steps) console.log(`${step.ok ? 'PASS' : 'FAIL'} ${step.name} :: ${step.detail}`)
    console.log(ok ? 'SELF-TEST: PASS' : 'SELF-TEST: FAIL')
  }
  return ok ? 0 : 1
}

// ---- 入口 -------------------------------------------------------------------

async function main() {
  if (hasFlag('help')) {
    console.log(USAGE)
    return 0
  }
  if (hasFlag('self-test')) {
    return selfTest(hasFlag('json'))
  }
  const options = {
    session: arg('session'),
    checkRecord: arg('check-record'),
    host: arg('host'),
    manual: arg('manual'),
    out: arg('out'),
    noRedact: hasFlag('no-redact'),
    json: hasFlag('json'),
  }
  const report = await probe(options)
  if (!options.json) printHuman(report)
  else console.log(JSON.stringify(report, null, 2))
  if (options.out) {
    writeFileSync(resolve(options.out), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.error(`[check-binding-host] 脱敏报告已写入 ${options.out}`)
  }
  return report.exitCode
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main().then((code) => { process.exitCode = code }).catch((error) => {
    console.error(`[check-binding-host] 运行失败：${error.message}`)
    process.exitCode = 2
  })
}

export {
  readSessionSnapshot,
  analyzeSession,
  h1Ring,
  h2Ring,
  h3Ring,
  h4Ring,
  h5Ring,
  h6Ring,
  probe,
}
