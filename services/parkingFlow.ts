/**
 * services/parkingFlow.ts
 * 核心业务逻辑：生成、解析、修复、增强
 * 适用于所有 LLM Provider
 */

import { ParkingLayout, ConstraintViolation, ElementType, LayoutElement, SceneDefinition } from '../types';
import { PROMPTS } from '../utils/prompts';
import { FLOOR_DRAFTSMAN_PROMPT } from '../utils/buildingPrompts';
import { DEFAULT_SCENE_ID, SCENE_REGISTRY } from '../utils/sceneRegistry';
import { safeParseResponse, normalizeLayoutElementTypes } from './responseParser';
import { getIntersectionBox, validateLayout, calculateVoidRatio } from '../utils/geometry';
import { LLMClient, LLMConfig } from './llmProvider';
import {
  mapToInternalLayout,
  postProcessLayout,
  applyScenePostProcess,
  mergeLayoutElements,
  mergePatchesToLayout,
  normalizePartialPatches,
  generateAutoConnectivityPatches,
  fixSmallGeometry,
  dedupePatchesAgainstLayout,
  enhanceLayoutWithGeometry,
  fillVoidsWithGround,
  calculateScore,
  sleep,
  normalizeType,
  compressPrompt
} from './aiCommonUtils';

// --- 配置常量 ---
const MAX_RETRIES = 3;
const MAX_FIX_PASSES = 4;

const getActiveScene = (sceneId?: string) => {
  const key = sceneId || DEFAULT_SCENE_ID;
  return SCENE_REGISTRY[key] || SCENE_REGISTRY[DEFAULT_SCENE_ID];
};

const applySceneTypeNormalization = (raw: any, sceneId?: string): any => {
  const scene = getActiveScene(sceneId);
  const map = scene.elementNormalization || {};
  const normalizeOne = (el: any) => {
    if (!el || typeof el !== 'object') return el;
    const rawType = el.t ?? el.type;
    if (!rawType) return el;
    const key = String(rawType).toLowerCase();
    const mapped = map[key];
    if (!mapped) return el;
    if (el.t != null) return { ...el, t: mapped };
    return { ...el, type: mapped };
  };
  const normalizeList = (arr: any) => (Array.isArray(arr) ? arr.map(normalizeOne) : arr);
  return {
    ...raw,
    elements: normalizeList(raw?.elements),
    new_elements: normalizeList(raw?.new_elements),
    modified_elements: normalizeList(raw?.modified_elements)
  };
};

/**
 * 带有重试机制的 LLM 调用
 */
export const callLLMWithRetry = async (
  client: LLMClient, 
  messages: any[], 
  config: LLMConfig, 
  onLog?: (msg: string) => void
): Promise<string> => {
  let lastError: Error | null = null;
  const compressedMessages = messages.map(m => ({
    ...m,
    content: compressPrompt(m.content)
  }));

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      if (i > 0) {
        onLog?.(`⏳ [${client.providerName}] 请求重试 ${i}/${MAX_RETRIES}...`);
        await sleep(1000 * i); // 指数退避
      }
      return await client.chat(compressedMessages, config);
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
  scene: SceneDefinition,
  onLog?: (msg: string) => void,
  options: { freezeStructural?: boolean; frozenIds?: string[] } = {}
): Promise<ParkingLayout> => {
  let currentLayout = layout;
  let lastScore = Infinity;
  const structuralTypes = new Set<string>([
    ElementType.ROAD,
    ElementType.GROUND,
    ElementType.RAMP,
    ElementType.ENTRANCE,
    ElementType.EXIT,
    ElementType.WALL_EXTERNAL,
    ElementType.SHEAR_WALL,
    ElementType.ELEVATOR_SHAFT,
    ElementType.ELEVATOR,
    ElementType.STAIRCASE
  ]);

  for (let pass = 1; pass <= MAX_FIX_PASSES; pass++) {
    let violations = validateLayout(currentLayout);
    if (scene.id === DEFAULT_SCENE_ID) {
      violations = violations.filter(v => v.elementId !== 'global_ground_check');
      violations = violations.filter(v =>
        !String(v.elementId || '').includes('auto_ground_void_') &&
        !String(v.targetId || '').includes('auto_ground_void_')
      );
    }
    if (scene.id !== DEFAULT_SCENE_ID) {
      violations = violations.filter(v => {
        if (v.type !== 'overlap') return true;
        if (!v.targetId) return true;
        const a = currentLayout.elements.find(e => e.id === v.elementId);
        const b = currentLayout.elements.find(e => e.id === v.targetId);
        if (!a || !b) return true;
        const box = getIntersectionBox(a, b);
        if (!box) return true;
        return Math.min(box.width, box.height) > 9;
      });
    }
    const score = calculateScore(violations);
    if (violations.length > 0) {
      const counts = violations.reduce((acc: Record<string, number>, v) => {
        acc[v.type] = (acc[v.type] || 0) + 1;
        return acc;
      }, {});
      const summary = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ');
      const samples = violations.slice(0, 6).map(v => `${v.type}:${v.elementId}`).join(', ');
      onLog?.(`🔎 违规统计: ${summary}`);
      onLog?.(`🔎 违规样例: ${samples}`);
    }

    if (score === 0) {
      onLog?.(`✅ [Fix Loop] 布局完美 (Pass ${pass}, Score 0)`);
      break;
    }
    
    // 如果分数没有改善且不是第一轮，提前退出（防止死循环）
    if (score >= lastScore && pass > 1) {
      if (options.freezeStructural) {
        onLog?.(`🛑 [Fix Loop] 优化停滞 (Score ${score}), 停止修复`);
        break;
      }
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
    const compactLayout: any = { width: currentLayout.width, height: currentLayout.height, elements: simplifiedInput };

    try {
      // 发送请求
      const fixResponse = await callLLMWithRetry(client, [
        { role: 'user', content: PROMPTS.fix(compactLayout, violations, scene, { frozenIds: options.frozenIds }) }
      ], { ...config, temperature: 0.1 }, onLog);

      const parsed = await safeParseResponse(fixResponse, { provider: client.providerName as any, model: config.model }, onLog);

      // 🟢 鸭子类型增量合并逻辑 (Smart Merge)
      // 优先查找 modified_elements，如果 AI 还是习惯性返回了 elements，也能兼容
      let patches: any[] = [];
      let deletedIds = [];
      let newPatches: any[] = [];
      
      if (parsed.modified_elements && Array.isArray(parsed.modified_elements)) {
        // 增量模式
        patches = parsed.modified_elements;
        deletedIds = parsed.deleted_ids || [];
        newPatches = Array.isArray(parsed.new_elements) ? parsed.new_elements : [];
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
          let cleaned = normalizePartialPatches(patches);
          let filteredDeletes = deletedIds;
          if (options.frozenIds && options.frozenIds.length > 0) {
            const frozenSet = new Set(options.frozenIds);
            cleaned = cleaned.filter(p => !frozenSet.has(String(p.id ?? p.element_id)));
            filteredDeletes = deletedIds.filter(id => !frozenSet.has(id));
          } else if (options.freezeStructural) {
            cleaned = cleaned.filter(p => {
              const pid = String(p.id ?? p.element_id ?? '');
              const existing = currentLayout.elements.find(el => el.id === pid);
              const t = normalizeType((existing?.type as any) ?? (p.type ?? p.t));
              return !structuralTypes.has(t);
            });
            filteredDeletes = deletedIds.filter(id => {
              const existing = currentLayout.elements.find(el => el.id === id);
              const t = normalizeType(existing?.type as any);
              return !structuralTypes.has(t);
            });
          }
          currentLayout = mergePatchesToLayout(currentLayout, cleaned, filteredDeletes, { mode: 'strict' });
          if (newPatches.length > 0) {
            let adds = mapToInternalLayout({ width: currentLayout.width, height: currentLayout.height, elements: newPatches }).elements;
            if (options.frozenIds && options.frozenIds.length > 0) {
              const frozenSet = new Set(options.frozenIds);
              adds = adds.filter(p => !frozenSet.has(String(p.id)));
            } else if (options.freezeStructural) {
              adds = adds.filter(p => !structuralTypes.has(normalizeType(p.type as any)));
            }
            if (adds.length > 0) {
              currentLayout = mergePatchesToLayout(currentLayout, adds, [], { mode: 'allowCreate' });
            }
          }
        } else {
          if (options.freezeStructural) {
            onLog?.(`⚠️ [Fix Loop] 忽略全量修复以保护骨架`);
          } else {
            const full = mapToInternalLayout({ width: currentLayout.width, height: currentLayout.height, elements: patches });
            currentLayout = { ...currentLayout, elements: full.elements };
          }
        }
      } else {
        if (options.freezeStructural) continue;
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

export const executeFloorGenerationWithCore = async (
  prompt: string,
  coreBlueprint: LayoutElement[],
  client: LLMClient,
  apiKey: string,
  model: string,
  onLog?: (msg: string) => void,
  sceneId?: string
): Promise<ParkingLayout> => {
  const scene = getActiveScene(sceneId);
  const isParkingScene = scene.id === DEFAULT_SCENE_ID;
  const config: LLMConfig = {
    apiKey,
    model,
    temperature: 0.9,
    maxTokens: 8192
  };

  onLog?.(` [${client.providerName}] 开始生成楼层...`);

  let floorLayout: ParkingLayout | null = null;
  let lastError: Error | null = null;
  const MAX_GEN_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_GEN_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        onLog?.(`🔄 生成重试 ${attempt}/${MAX_GEN_RETRIES}: 上次结果不完整...`);
        await sleep(1000);
      }

      const responseText = await callLLMWithRetry(client, [
        { role: 'user', content: FLOOR_DRAFTSMAN_PROMPT(prompt, coreBlueprint, scene) }
      ], config, onLog);

      const rawParsed = await safeParseResponse(responseText, { provider: client.providerName as any, model }, onLog);
      const rawData = applySceneTypeNormalization(rawParsed, sceneId);
      if (rawData.reasoning_plan && onLog) onLog(`🧠 Plan: ${rawData.reasoning_plan}`);

      const deltaElements = Array.isArray(rawData?.new_elements)
        ? rawData.new_elements
        : Array.isArray(rawData?.elements)
          ? rawData.elements
          : [];

      const deltaLayout = mapToInternalLayout({
        width: rawData?.width || 800,
        height: rawData?.height || 600,
        elements: deltaElements
      });

      const coreIds = coreBlueprint.map(e => e.id);
      const coreIdSet = new Set(coreIds);
      const seen = new Set<string>();
      const newElements = deltaLayout.elements.filter(e => {
        if (!e?.id) return false;
        if (coreIdSet.has(e.id)) return false;
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });

      const merged: ParkingLayout = {
        ...deltaLayout,
        elements: [...newElements, ...coreBlueprint]
      };

      if (isParkingScene) validateGeneratedContent(merged);
      else validateFloorPlanDelta(newElements, deltaLayout);
      floorLayout = merged;

      onLog?.(`✅ 初步生成成功: 包含 ${newElements.length} 个新增元素`);
      break;
    } catch (e: any) {
      lastError = e;
      onLog?.(`⚠️ 生成质量校验失败: ${e.message}`);
      if (attempt === MAX_GEN_RETRIES) {
        throw new Error(`生成失败，模型连续 ${MAX_GEN_RETRIES} 次输出不完整: ${e.message}`);
      }
    }
  }

  if (!floorLayout) throw lastError || new Error("Unknown floor generation error");
  const frozenIds = coreBlueprint.map(e => e.id);

  if (!isParkingScene) {
    const hasSlab = floorLayout.elements.some(e => e.type === ElementType.SLAB);
    const withSlab = hasSlab
      ? floorLayout
      : {
          ...floorLayout,
          elements: [
            { id: 'floor_slab', type: ElementType.SLAB, x: 0, y: 0, width: 800, height: 600 },
            ...floorLayout.elements
          ]
        };
    return applyScenePostProcess(withSlab, scene, onLog);
  }

  let fixedLayout = await runIterativeFix(
    floorLayout,
    client,
    { ...config, temperature: 0.1 },
    scene,
    onLog,
    { freezeStructural: true, frozenIds }
  );
  fixedLayout = fillVoidsWithGround(fixedLayout);
  return applyScenePostProcess(fixedLayout, scene, onLog);
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

const validateFloorPlanDelta = (newElements: LayoutElement[], deltaLayout: ParkingLayout): void => {
  if (newElements.length < 15) {
    throw new Error(`Incomplete floor plan: Only ${newElements.length} new elements found. AI stopped early.`);
  }
  const hasWalls = deltaLayout.elements.some(e => {
    const t = normalizeType(e.type as any);
    return t === ElementType.WALL_EXTERNAL || t === ElementType.WALL_INTERNAL || t === ElementType.WALL;
  });
  if (!hasWalls) {
    throw new Error('Incomplete floor plan: No walls detected.');
  }
  const hasDoor = deltaLayout.elements.some(e => normalizeType(e.type as any) === ElementType.DOOR);
  if (!hasDoor) {
    throw new Error('Incomplete floor plan: No doors detected.');
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
  onLog?: (msg: string) => void,
  sceneId?: string
): Promise<ParkingLayout> => {
  const config: LLMConfig = {
    apiKey, model,
    temperature: 1.2,
    maxTokens: 8192
  };

  onLog?.(` [${client.providerName}] 开始生成...`);
  const scene = getActiveScene(sceneId);
  const isParkingScene = scene.id === DEFAULT_SCENE_ID;

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
        { role: 'user', content: PROMPTS.generation(prompt, scene) }
      ], config, onLog);

      // 解析
      const rawParsed = await safeParseResponse(responseText, { provider: client.providerName as any, model }, onLog);
      const rawData = applySceneTypeNormalization(rawParsed, sceneId);
      layout = mapToInternalLayout(rawData);
      
      if (rawData.reasoning_plan && onLog) onLog(`🧠 Plan: ${rawData.reasoning_plan}`);

      // 3. 立即验证完整性
      if (isParkingScene) validateGeneratedContent(layout);

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

  if (!isParkingScene) return applyScenePostProcess(layout, scene, onLog);

  layout = await runIterativeFix(layout, client, config, scene, onLog);
  layout = fillVoidsWithGround(layout);
  layout = applyScenePostProcess(layout, scene, onLog);
  const voidRatio = calculateVoidRatio(layout);
  if (voidRatio > 0.005) {
    const msg = `Void ratio too high before refinement: ${(voidRatio * 100).toFixed(3)}%`;
    onLog?.(`❌ ${msg}`);
  }
  return layout;
};

/**
 * 主入口：统一细化/增强流程 (Augment)
 */
export const executeRefinement = async (
  currentLayout: ParkingLayout,
  client: LLMClient,
  apiKey: string,
  model: string,
  onLog?: (msg: string) => void,
  sceneId?: string
): Promise<ParkingLayout> => {
  const scene = getActiveScene(sceneId);
  const isParkingScene = scene.id === DEFAULT_SCENE_ID;
  // 细化阶段 AI 负责生成新元素
  const config: LLMConfig = { apiKey, model, temperature: 0.2, maxTokens: 8192 };
  const voidRatio = calculateVoidRatio(currentLayout);
  if (isParkingScene && voidRatio > 0.005) {
    const msg = `Void ratio too high before refinement: ${(voidRatio * 100).toFixed(3)}%`;
    onLog?.(`❌ ${msg}`);
    // throw new Error(msg);
  }

  onLog?.(`✨ [${client.providerName}] 开始细化布局 (增量模式)...`);

  // 1. 输入瘦身
  const structuralElements = isParkingScene
    ? currentLayout.elements.filter(e => ['WALL', 'ROAD', 'driving_lane', 'GROUND', 'ground', 'wall'].includes(e.type))
    : currentLayout.elements;
  
  const simplified = structuralElements.map(e => ({
    id: e.id, t: e.type, x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.width), h: Math.round(e.height)
  }));

  try {
    // 2. AI 生成新细节 (柱子、标线等)
    const responseText = await callLLMWithRetry(client, [
      { role: 'user', content: PROMPTS.optimizeSystemPrompt({ elements: simplified }, currentLayout.width, currentLayout.height, scene) }
    ], config, onLog);

    const parsed = await safeParseResponse(responseText, { provider: client.providerName as any, model }, onLog);
    const rawData = applySceneTypeNormalization(parsed, sceneId);

    // 🧠 分支逻辑：全量 vs 增量（修复数组拼接导致的重复/重叠问题）
    let layout: ParkingLayout = currentLayout;
    if (isParkingScene && rawData.modified_elements && Array.isArray(rawData.modified_elements)) {
      onLog?.(`🩹 应用修改补丁: ${rawData.modified_elements.length} 个`);
      let updates = normalizePartialPatches(rawData.modified_elements);
      const structuralTypes = new Set<string>([
        ElementType.WALL,
        ElementType.ROAD,
        ElementType.GROUND,
        ElementType.RAMP,
        ElementType.ENTRANCE,
        ElementType.EXIT,
        ElementType.WALL_EXTERNAL,
        ElementType.SHEAR_WALL,
        ElementType.ELEVATOR_SHAFT,
        ElementType.ELEVATOR,
        ElementType.STAIRCASE
      ]);
      updates = updates.filter(p => {
        const pid = String(p.id ?? p.element_id ?? '');
        const existing = currentLayout.elements.find(el => el.id === pid);
        const t = normalizeType((existing?.type as any) ?? (p.type ?? p.t));
        return !structuralTypes.has(t);
      });
      const filteredDeletes = (rawData.deleted_ids || []).filter((id: string) => {
        const existing = currentLayout.elements.find(el => el.id === id);
        const t = normalizeType(existing?.type as any);
        return !structuralTypes.has(t);
      });
      layout = mergePatchesToLayout(currentLayout, updates, filteredDeletes, { mode: 'strict' });
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
    if (isParkingScene) {
      layout = await enhanceLayoutWithGeometry(layout, onLog);
    }

    // 🟢 4. 最终修复 (The Final Polish)
    onLog?.(`🔧 执行最终冲突微调 (增量安全模式)...`);
    
    // 使用极低温度 (0.0) 确保它只做数学题，不发挥想象力
    if (isParkingScene) {
      layout = await runIterativeFix(layout, client, { ...config, temperature: 0.0 }, scene, onLog, { freezeStructural: true });
    }

    onLog?.(`✅ 细化流程全部完成`);
    return postProcessLayout(layout);

  } catch (error: any) {
    onLog?.(`❌ 细化阶段出错: ${error.message}`);
    return currentLayout;
  }
};
