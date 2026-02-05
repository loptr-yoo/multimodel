/**
 * 统一的 AI 响应解析器
 * 处理不同模型（Gemini、DeepSeek、GPT）的响应格式差异
 */

import { jsonrepair } from 'jsonrepair';

export interface ParseOptions {
  provider: 'gemini' | 'deepseek' | 'openai';
  model: string;
  strictMode?: boolean; // 严格模式下要求有效的 JSON
}

/**
 * 类型映射：将 AI 返回的类型名称映射到系统类型枚举值
 * 用于处理不同 AI 模型返回的类型名称差异
 */
const TYPE_MAPPING: Record<string, string> = {
  // 标准映射
  'GROUND': 'ground',
  'ground': 'ground',
  'ROAD': 'driving_lane',
  'road': 'driving_lane',
  'PARKING_SPACE': 'parking_space',
  'parking_space': 'parking_space',
  'SIDEWALK': 'pedestrian_path',
  'sidewalk': 'pedestrian_path',
  'pedestrian_path': 'pedestrian_path',
  'RAMP': 'slope',
  'ramp': 'slope',
  'slope': 'slope',
  'PILLAR': 'pillar',
  'pillar': 'pillar',
  'WALL': 'wall',
  'wall': 'wall',
  'ENTRANCE': 'entrance',
  'entrance': 'entrance',
  'EXIT': 'exit',
  'exit': 'exit',
  'STAIRCASE': 'staircase',
  'staircase': 'staircase',
  'ELEVATOR': 'elevator',
  'elevator': 'elevator',
  'CHARGING_STATION': 'charging_station',
  'charging_station': 'charging_station',
  'GUIDANCE_SIGN': 'guidance_sign',
  'guidance_sign': 'guidance_sign',
  'SAFE_EXIT': 'safe_exit',
  'safe_exit': 'safe_exit',
  'SPEED_BUMP': 'deceleration_zone',
  'speed_bump': 'deceleration_zone',
  'deceleration_zone': 'deceleration_zone',
  'FIRE_EXTINGUISHER': 'fire_extinguisher',
  'fire_extinguisher': 'fire_extinguisher',
  'LANE_LINE': 'ground_line',
  'lane_line': 'ground_line',
  'ground_line': 'ground_line',
  'CONVEX_MIRROR': 'convex_mirror',
  'convex_mirror': 'convex_mirror',
  // 备选映射
  'driving_lane': 'driving_lane',
};

/**
 * 将 AI 返回的布局数据中的类型转换为系统类型
 * @param layout - 来自 AI 的原始布局数据
 * @returns 转换后的布局数据
 */
export const normalizeLayoutElementTypes = (layout: any): any => {
  if (!layout || !Array.isArray(layout.elements)) {
    return layout;
  }

  return {
    ...layout,
    elements: layout.elements.map((element: any) => ({
      ...element,
      type: TYPE_MAPPING[element.type] || element.type, // 如果没有映射，保持原值
    })),
  };
};

/**
 * 从文本中提取 JSON 对象
 * 处理三种常见情况：
 * 1. 纯 JSON 响应
 * 2. Markdown 代码块中的 JSON (```json ... ```)
 * 3. 带有解释文本的 JSON
 */
export const extractJSON = (text: string): string => {
  let cleaned = text.trim();

  // 移除 markdown 代码块
  cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*/g, '');

  // 查找第一个 { 和最后一个 }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  return cleaned;
};

/**
 * DeepSeek 专用处理
 * DeepSeek 倾向于返回带有解释文本的响应
 */
export const parseDeepSeekResponse = (text: string): any => {
  // DeepSeek 经常在 JSON 前后加上解释文本
  let jsonText = extractJSON(text);

  try {
    return JSON.parse(jsonText);
  } catch (e) {
    // 尝试修复 JSON
    try {
      const repaired = jsonrepair(jsonText);
      return JSON.parse(repaired);
    } catch (e2) {
      // 如果还是失败，尝试查找任何 JSON 对象
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e3) {
          const repaired = jsonrepair(jsonMatch[0]);
          return JSON.parse(repaired);
        }
      }
      throw new Error(`Failed to parse DeepSeek response: ${(e2 as Error).message}`);
    }
  }
};

/**
 * Gemini 专用处理
 * Gemini 使用 application/json 响应类型，但仍可能有格式问题
 */
export const parseGeminiResponse = (text: string): any => {
  let jsonText = extractJSON(text);
  // 首先尝试直接解析
  try {
    return JSON.parse(jsonText);
  } catch (e) {
    // 然后尝试用 jsonrepair 修复常见小错误
    try {
      const repaired = jsonrepair(jsonText);
      return JSON.parse(repaired);
    } catch (e2) {
      // 回退策略：尝试从原始文本中提取任意 JSON 对象并修复
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const candidate = jsonMatch[0];
        try {
          return JSON.parse(candidate);
        } catch (e3) {
          // 如果是截断导致缺少右括号，做简单的括号平衡补全后再尝试修复
          const balance = (str: string) => {
            let open = 0;
            for (const ch of str) {
              if (ch === '{') open++;
              else if (ch === '}') open--;
            }
            return open;
          };

          let balanced = candidate;
          const openCount = balance(candidate);
          if (openCount > 0 && openCount < 20) {
            balanced = candidate + '}'.repeat(openCount);
          }

          try {
            const repaired2 = jsonrepair(balanced);
            return JSON.parse(repaired2);
          } catch (e4) {
            // 最后仍然失败，抛出包含更多上下文的错误
            const msg = (e4 as Error).message || String(e4);
            throw new Error(`Failed to parse Gemini response: ${msg}`);
          }
        }
      }

      throw new Error(`Failed to parse Gemini response: ${(e2 as Error).message}`);
    }
  }
};

/**
 * GPT (OpenAI) 专用处理
 * GPT 可能返回 markdown 格式的 JSON
 */
export const parseGPTResponse = (text: string): any => {
  let jsonText = extractJSON(text);

  try {
    return JSON.parse(jsonText);
  } catch (e) {
    // GPT 可能返回有尾逗号或其他小错误的 JSON
    try {
      const repaired = jsonrepair(jsonText);
      return JSON.parse(repaired);
    } catch (e2) {
      throw new Error(`Failed to parse GPT response: ${(e2 as Error).message}`);
    }
  }
};

/**
 * 统一的响应解析接口
 */
export const parseAIResponse = (text: string, options: ParseOptions): any => {
  if (!text || typeof text !== 'string') {
    throw new Error('Invalid response: expected string');
  }

  try {
    switch (options.provider) {
      case 'deepseek':
        return parseDeepSeekResponse(text);
      case 'gemini':
        return parseGeminiResponse(text);
      case 'openai':
        return parseGPTResponse(text);
      default:
        // 默认尝试通用解析
        return parseGeminiResponse(text);
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Parse error: ${String(error)}`);
  }
};

/**
 * 验证解析的数据是否为有效的停车场布局
 */
export const validateParkingLayout = (data: any): boolean => {
  if (!data || typeof data !== 'object') {
    return false;
  }

  // 必需字段检查
  if (!('width' in data) || !('height' in data) || !('elements' in data)) {
    return false;
  }

  // 类型检查
  if (typeof data.width !== 'number' || typeof data.height !== 'number') {
    return false;
  }

  if (!Array.isArray(data.elements)) {
    return false;
  }

  // 检查至少有一些元素或至少是有效的空数组
  if (data.elements.length > 0) {
    // 检查第一个元素的基本结构
    const firstElement = data.elements[0];
    if (!('x' in firstElement) || !('y' in firstElement) || !('type' in firstElement)) {
      return false;
    }
  }

  return true;
};

/**
 * 详细的响应诊断 - 用于调试
 */
export const diagnoseResponse = (
  text: string,
  options: ParseOptions
): {
  provider: string;
  model: string;
  rawLength: number;
  hasJSON: boolean;
  hasMarkdown: boolean;
  firstBraceIndex: number;
  lastBraceIndex: number;
  parseSuccess: boolean;
  parseError?: string;
} => {
  const hasJSON = /\{[\s\S]*\}/.test(text);
  const hasMarkdown = /```/.test(text);
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  let parseSuccess = false;
  let parseError: string | undefined;

  try {
    parseAIResponse(text, options);
    parseSuccess = true;
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }

  return {
    provider: options.provider,
    model: options.model,
    rawLength: text.length,
    hasJSON,
    hasMarkdown,
    firstBraceIndex: firstBrace,
    lastBraceIndex: lastBrace,
    parseSuccess,
    parseError,
  };
};

/**
 * 安全的响应解析与转换
 * 添加了详细的日志输出便于调试
 */
export const safeParseResponse = async (
  text: string,
  options: ParseOptions,
  onLog?: (msg: string) => void
): Promise<any> => {
  onLog?.(`[${options.provider}] 开始解析响应...`);
  onLog?.(`[${options.provider}] 响应长度: ${text.length} 字符`);

  // 记录提取到的 JSON 摘要，便于诊断（控制长度以免日志过大）
  try {
    const extracted = extractJSON(text);
    const snippet = extracted.length > 800 ? extracted.substring(0, 800) + '...' : extracted;
    onLog?.(`[${options.provider}] 提取 JSON 长度: ${extracted.length}`);
    onLog?.(`[${options.provider}] 提取 JSON 摘要: ${snippet}`);
  } catch (e) {
    // 忽略提取日志失败
  }

  // 诊断响应
  const diagnosis = diagnoseResponse(text, options);
  onLog?.(`[${options.provider}] 诊断: JSON=${diagnosis.hasJSON}, Markdown=${diagnosis.hasMarkdown}`);

  try {
    const parsed = parseAIResponse(text, options);
    onLog?.(`[${options.provider}] 解析成功`);

    // 规范化元素类型
    const normalized = normalizeLayoutElementTypes(parsed);
    onLog?.(`[${options.provider}] 类型转换完成`);

    // 验证数据结构
    if (!validateParkingLayout(normalized)) {
      onLog?.(`[${options.provider}] 警告: 数据结构可能不完整`);
    }

    return normalized;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    onLog?.(`[${options.provider}] 解析失败: ${errorMsg}`);

    // 提供更多诊断信息
    if (text.length > 1000) {
      onLog?.(`[${options.provider}] 响应摘要: ${text.substring(0, 200)}...`);
    } else {
      onLog?.(`[${options.provider}] 完整响应: ${text}`);
    }

    throw error;
  }
};
