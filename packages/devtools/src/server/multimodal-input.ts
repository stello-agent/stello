/** DevTools 多模态输入内容标记。 */
export const DEVTOOLS_MULTIMODAL_MARKER = '[stello-devtools:multimodal/v1]'

/** 文本输入块。 */
export interface DevtoolsTextInputPart {
  type: 'text'
  text: string
}

/** 图片输入块。 */
export interface DevtoolsImageInputPart {
  type: 'image_url' | 'image'
  imageUrl: string
  mimeType?: string
  name?: string
}

/** DevTools 支持的多模态输入块。 */
export type DevtoolsInputPart = DevtoolsTextInputPart | DevtoolsImageInputPart

/** DevTools 对外接受的输入。 */
export type DevtoolsTurnInput = string | { parts: DevtoolsInputPart[] }

interface EncodedMultimodalPayload {
  parts: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; imageUrl: string; mimeType?: string; name?: string }
  >
}

/** 规范化多模态输入为 agent 可消费的字符串。 */
export function normalizeTurnInput(input: unknown): string {
  if (typeof input === 'string') return input

  const parts = parseMultimodalParts(input)
  if (parts.length === 0) {
    throw new Error('Invalid input: expected non-empty string or multimodal parts')
  }

  if (parts.length === 1) {
    const firstPart = parts[0]
    if (firstPart && firstPart.type === 'text') {
      return firstPart.text
    }
  }

  return `${DEVTOOLS_MULTIMODAL_MARKER}\n${JSON.stringify({ parts })}`
}

/** 从输入对象中提取并校验多模态 parts。 */
function parseMultimodalParts(input: unknown): EncodedMultimodalPayload['parts'] {
  if (!isRecord(input)) return []
  const rawParts = input['parts']
  if (!Array.isArray(rawParts)) return []

  const normalized: EncodedMultimodalPayload['parts'] = []
  for (const rawPart of rawParts) {
    const next = normalizePart(rawPart)
    if (next) normalized.push(next)
  }
  return normalized
}

/** 规范化单个输入块。 */
function normalizePart(part: unknown): EncodedMultimodalPayload['parts'][number] | null {
  if (!isRecord(part)) return null
  const type = part['type']

  if (type === 'text') {
    const text = typeof part['text'] === 'string' ? part['text'] : ''
    const trimmed = text.trim()
    if (!trimmed) return null
    return { type: 'text', text: trimmed }
  }

  if (type === 'image' || type === 'image_url') {
    const imageUrl = readString(part, ['imageUrl', 'url'])
    if (!imageUrl) return null
    const payload: EncodedMultimodalPayload['parts'][number] = {
      type: 'image',
      imageUrl,
    }
    const mimeType = typeof part['mimeType'] === 'string' ? part['mimeType'] : undefined
    const name = typeof part['name'] === 'string' ? part['name'] : undefined
    if (mimeType) payload.mimeType = mimeType
    if (name) payload.name = name
    return payload
  }

  return null
}

/** 从候选键列表中读取首个非空字符串。 */
function readString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return null
}

/** 判断未知值是否为对象字典。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
