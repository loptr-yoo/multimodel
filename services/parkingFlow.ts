/**
 * services/parkingFlow.ts
 * 核心业务逻辑：生成、解析、修复、增强
 * 适用于所有 LLM Provider
 */

import { ParkingLayout, ConstraintViolation } from '../types';
import { PROMPTS } from '../utils/prompts';
import { safeParseResponse, normalizeLayoutElementTypes } from './responseParser';
import { validateLayout } from '../utils/geometry';
import { LLMClient, LLMConfig } from './llmProvider';
import {
  mapToInternalLayout,
  postProcessLayout,
  mergeLayoutElements,
  mergePatchesToLayout,
  normalizePartialPatches,
  generateAutoConnectivityPatches,
  fixSmallGeometry,
  dedupePatchesAgainstLayout,
  enhanceLayoutWithGeometry,
  fillVoidsWithGround,
  calculateScore,
  sleep
} from './aiCommonUtils';

// --- 配置常量 ---
const MAX_RETRIES = 3;
const MAX_FIX_PASSES = 4;

/**
 * 带有重试机制的 LLM 调用
 */
const callLLMWithRetry = async (
  client: LLMClient, 
  messages: any[], 
  config: LLMConfig, 
  onLog?: (msg: string) => void
): Promise<string> => {
  let lastError: Error | null = null;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      if (i > 0) {
        onLog?.(`⏳ [${client.providerName}] 请求重试 ${i}/${MAX_RETRIES}...`);
        await sleep(1000 * i); // 指数退避
      }
      return await client.chat(messages, config);
    } catch (e: any) {
      lastError = e;
      onLog?.(`⚠️ [${client.providerName}] 调用失败: ${e.message}`);
    }
  }
  throw lastError || new Error("Max retries exceeded");
};

/**
 * 统一的自动修复循环 (Fix Loop)
 */
const runIterativeFix = async (
  layout: ParkingLayout,
  client: LLMClient,
  config: LLMConfig,
  onLog?: (msg: string) => void
): Promise<ParkingLayout> => {
  let currentLayout = layout;
  let lastScore = Infinity;

  for (let pass = 1; pass <= MAX_FIX_PASSES; pass++) {
    const violations = validateLayout(currentLayout);
    const score = calculateScore(violations);

    if (score === 0) {
      onLog?.(`✅ [Fix Loop] 布局完美 (Pass ${pass}, Score 0)`);
      break;
    }
    
    // 如果分数没有改善且不是第一轮，提前退出（防止死循环）
    if (score >= lastScore && pass > 1) {
      const autoPatches = generateAutoConnectivityPatches(currentLayout);
      if (autoPatches.length > 0) {
        onLog?.(`🧩 触发自动补丁: ${autoPatches.length} 个`);
        const cleaned = normalizePartialPatches(autoPatches);
        currentLayout = mergePatchesToLayout(currentLayout, cleaned, []);
        continue;
      }
      onLog?.(`🛑 [Fix Loop] 优化停滞 (Score ${score}), 停止修复`);
      break;
    }

    onLog?.(`🔧 [Fix Loop] 修复轮次 ${pass}/${MAX_FIX_PASSES} (Score: ${score}, Violations: ${violations.length})`);
    lastScore = score;

    // 简化输入以节省 Token
    const simplifiedInput = currentLayout.elements.map(e => ({
      id: e.id, t: e.type, x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.width), h: Math.round(e.height), r: e.rotation
    }));

    try {
      // 发送请求
      const fixResponse = await callLLMWithRetry(client, [
        { role: 'user', content: PROMPTS.fix(simplifiedInput as any, violations) }
      ], { ...config, temperature: 0.1 }, onLog);

      const parsed = await safeParseResponse(fixResponse, { provider: client.providerName as any, model: config.model }, onLog);

      // 🟢 鸭子类型增量合并逻辑 (Smart Merge)
      // 优先查找 modified_elements，如果 AI 还是习惯性返回了 elements，也能兼容
      let patches: any[] = [];
      let deletedIds = [];
      
      if (parsed.modified_elements && Array.isArray(parsed.modified_elements)) {
        // 增量模式
        patches = parsed.modified_elements;
        deletedIds = parsed.deleted_ids || [];
        onLog?.(`🔧 应用 ${patches.length} 个修复补丁，删除 ${deletedIds.length} 个元素...`);
      } else if (parsed.elements && Array.isArray(parsed.elements)) {
        // 全量模式
        patches = parsed.elements;
        onLog?.(`🔧 应用全量更新 (${patches.length} 个元素)...`);
      } else {
        onLog?.(`⚠️ AI 未返回有效修复，跳过此轮`);
        continue;
      }
      
      if (patches.length > 0) {
        if (parsed.modified_elements && !parsed.elements) {
      const cleaned = normalizePartialPatches(patches);
      currentLayout = mergePatchesToLayout(currentLayout, cleaned, deletedIds, { mode: 'strict' });
        } else {
          const full = mapToInternalLayout({ width: currentLayout.width, height: currentLayout.height, elements: patches });
          currentLayout = { ...currentLayout, elements: full.elements };
        }
      } else {
        const autoPatches = generateAutoConnectivityPatches(currentLayout);
        if (autoPatches.length > 0) {
          onLog?.(`🧩 模型返回空补丁，应用自动补丁 ${autoPatches.length} 个`);
          const cleaned = normalizePartialPatches(autoPatches);
          const uniqueAuto = dedupePatchesAgainstLayout(currentLayout, cleaned, 5);
          if (uniqueAuto.length > 0) {
            currentLayout = mergePatchesToLayout(currentLayout, uniqueAuto, [], { mode: 'allowCreate' });
          }
        }
      }

    } catch (e: any) {
      onLog?.(`⚠️ 修复出错: ${e.message}`);
      break;
    }
  }

  return currentLayout;
};
const validateGeneratedContent = (layout: ParkingLayout): void =>
 {
  // 1. 数量检查：一个完整的停车场不可能少于 5 个元素
  if (layout.elements.length < 5
) {
    throw new Error(`Incomplete generation: Only ${layout.elements.length} elements found. AI stopped early.`
);
  }

  // 2. 关键元素检查：必须有路 (ROAD/driving_lane)
  const hasRoad = layout.elements.some(e => e.type === 'driving_lane' || e.type === 'ROAD'
);
  if
 (!hasRoad) {
    throw new Error("Incomplete generation: No roads detected. AI failed to generate layout interior."
);
  }
};
/**
 * 主入口：统一生成流程
 */
export const executeGeneration = async (
  prompt: string,
  client: LLMClient,
  apiKey: string,
  model: string,
  onLog?: (msg: string) => void
): Promise<ParkingLayout> => {
  const config: LLMConfig = {
    apiKey, model,
    temperature: 1.2,
    maxTokens: 8192
  };

  onLog?.(` [${client.providerName}] 开始生成...`);

  let layout: ParkingLayout | null = null;
  let lastError: Error | null = null;

  // 2. 语义重试循环 (Semantic Retry Loop)
  // 如果 AI 生成了残次品，给他 3 次机会重画
  const MAX_GEN_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_GEN_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        onLog?.(`🔄 生成重试 ${attempt}/${MAX_GEN_RETRIES}: 上次结果不完整...`);
        await sleep(1000); // 稍微冷却
      }

      // 发送 Single-Shot Prompt (不带 System Prompt 以集中权重)
      const responseText = await callLLMWithRetry(client, [
        { role: 'user', content: PROMPTS.generation(prompt) }
      ], config, onLog);

      // 解析
      const rawData = await safeParseResponse(responseText, { provider: client.providerName as any, model }, onLog);
      layout = mapToInternalLayout(rawData);
      
      if (rawData.reasoning_plan && onLog) onLog(`🧠 Plan: ${rawData.reasoning_plan}`);

      // 3. 立即验证完整性
      validateGeneratedContent(layout);

      // 如果验证通过，跳出循环
      onLog?.(`✅ 初步生成成功: 包含 ${layout.elements.length} 个元素`);
      break;

    } catch (e: any) {
      lastError = e;
      onLog?.(`⚠️ 生成质量校验失败: ${e.message}`);
      // 如果是最后一次尝试，抛出异常
      if (attempt === MAX_GEN_RETRIES) {
        throw new Error(`生成失败，模型连续 ${MAX_GEN_RETRIES} 次输出不完整: ${e.message}`);
      }
    }
  }

  if (!layout) throw lastError || new Error("Unknown generation error");

  // 3. 自动修复循环
  layout = await runIterativeFix(layout, client, config, onLog);

  // 4. 自动填充空洞 (确保粗粒度图也没有黑洞)
  layout = fillVoidsWithGround(layout);

  return postProcessLayout(layout);
};

/**
 * 主入口：统一细化/增强流程 (Augment)
 */
export const executeRefinement = async (
  currentLayout: ParkingLayout,
  client: LLMClient,
  apiKey: string,
  model: string,
  onLog?: (msg: string) => void
): Promise<ParkingLayout> => {
  // 细化阶段 AI 负责生成新元素
  const config: LLMConfig = { apiKey, model, temperature: 0.2, maxTokens: 8192 };

  onLog?.(`✨ [${client.providerName}] 开始细化布局 (增量模式)...`);

  // 1. 输入瘦身
  const structuralElements = currentLayout.elements.filter(e => 
    ['WALL', 'ROAD', 'driving_lane', 'GROUND', 'ground', 'wall'].includes(e.type)
  );
  
  const simplified = structuralElements.map(e => ({
    id: e.id, t: e.type, x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.width), h: Math.round(e.height)
  }));

  try {
    // 2. AI 生成新细节 (柱子、标线等)
    const responseText = await callLLMWithRetry(client, [
      { role: 'user', content: PROMPTS.optimizeSystemPrompt({ elements: simplified }, currentLayout.width, currentLayout.height) }
    ], config, onLog);

    const rawData = await safeParseResponse(responseText, { provider: client.providerName as any, model }, onLog);

    // 🧠 分支逻辑：全量 vs 增量（修复数组拼接导致的重复/重叠问题）
    let layout: ParkingLayout = currentLayout;
    if (rawData.modified_elements && Array.isArray(rawData.modified_elements)) {
      onLog?.(`🩹 应用修改补丁: ${rawData.modified_elements.length} 个`);
      const updates = normalizePartialPatches(rawData.modified_elements);
      layout = mergePatchesToLayout(currentLayout, updates, rawData.deleted_ids || [], { mode: 'strict' });
    } else if (rawData.new_elements && Array.isArray(rawData.new_elements)) {
      onLog?.(`➕ 应用新增元素: ${rawData.new_elements.length} 个`);
      const adds = mapToInternalLayout({
        width: currentLayout.width,
        height: currentLayout.height,
        elements: rawData.new_elements
      }).elements;
      layout = mergePatchesToLayout(currentLayout, adds, [], { mode: 'allowCreate' });
    } else if (rawData.elements && Array.isArray(rawData.elements)) {
      onLog?.(`📥 应用全量更新: ${rawData.elements.length} 个元素`);
      
      // 🛑 [FIX] 解压缩写 (t->type, w->width, h->height)
      const expandedElements = normalizePartialPatches(rawData.elements);

      const normalizedElements = mapToInternalLayout({
        width: rawData.width || currentLayout.width,
        height: rawData.height || currentLayout.height,
        elements: expandedElements
      }).elements;
      layout = {
        ...currentLayout,
        width: rawData.width || currentLayout.width,
        height: rawData.height || currentLayout.height,
        elements: normalizedElements
      };
    } else {
      onLog?.(`⚠️ AI 未返回有效元素，跳过更新`);
      return currentLayout;
    }

    

    layout = fixSmallGeometry(layout);
    // 3. 几何增强 (铺车位、加充电桩)
    // 这一步会产生大量 PARKING_SPACE，可能会与 AI 生成的柱子重叠
    layout = await enhanceLayoutWithGeometry(layout, onLog);

    // 🟢 4. 最终修复 (The Final Polish)
    onLog?.(`🔧 执行最终冲突微调 (增量安全模式)...`);
    
    // 使用极低温度 (0.0) 确保它只做数学题，不发挥想象力
    layout = await runIterativeFix(layout, client, { ...config, temperature: 0.0 }, onLog);

    onLog?.(`✅ 细化流程全部完成`);
    return postProcessLayout(layout);

  } catch (error: any) {
    onLog?.(`❌ 细化阶段出错: ${error.message}`);
    return currentLayout;
  }
};
