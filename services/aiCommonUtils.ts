/**
 * services/aiCommonUtils.ts
 * 通用工具库：包含核心几何算法和布局处理逻辑
 * 核心修复：找回了丢失的 fillParkingAutomatically 等关键算法
 */

import { ParkingLayout, ElementType, LayoutElement, ConstraintViolation } from '../types';
import { validateLayout, getIntersectionBox } from '../utils/geometry';

// =============== 基础工具 ===============

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 将模型/AI输出的类型名称归一化为内部 ElementType 或兼容字符串
 */
export const normalizeType = (t: string | undefined): string => {
  if (!t) return ElementType.WALL;
  const key = t.toLowerCase().trim().replace(/\s+/g, '_');
  const map: Record<string, string> = {
    ramp: ElementType.RAMP,
    slope: ElementType.RAMP,
    speed_bump: ElementType.SPEED_BUMP,
    deceleration_zone: ElementType.SPEED_BUMP,
    road: ElementType.ROAD,
    driving_lane: ElementType.ROAD,
    pedestrian_path: ElementType.SIDEWALK,
    sidewalk: ElementType.SIDEWALK,
    ground_line: ElementType.LANE_LINE,
    lane_line: ElementType.LANE_LINE,
    parking_spot: ElementType.PARKING_SPACE,
    parking_space: ElementType.PARKING_SPACE,
    parking: ElementType.PARKING_SPACE,
    charging: ElementType.CHARGING_STATION,
    charging_station: ElementType.CHARGING_STATION,
    ev_charging_zone: ElementType.CHARGING_STATION,
    charging_zone: ElementType.CHARGING_STATION,
    ground: ElementType.GROUND,
    island: ElementType.GROUND,
    landscape: ElementType.GROUND,
    landscape_area: ElementType.GROUND,
    buffer: ElementType.GROUND,
    median: ElementType.GROUND,
    pillar: ElementType.PILLAR,
    elevator_hall: ElementType.ELEVATOR,
    elevator: ElementType.ELEVATOR,
    staircase: ElementType.STAIRCASE,
    stairs: ElementType.STAIRCASE,
    fire_stairs: ElementType.STAIRCASE,
    safe_exit: ElementType.SAFE_EXIT,
    fire_extinguisher: ElementType.FIRE_EXTINGUISHER,
    guidance_sign: ElementType.GUIDANCE_SIGN,
    parking_strip: ElementType.GROUND,
    central_island: ElementType.GROUND,
    green_zone: ElementType.GROUND,
    void: ElementType.GROUND,
    wall: ElementType.WALL,
    entrance: ElementType.ENTRANCE,
    exit: ElementType.EXIT,
    convex_mirror: ElementType.CONVEX_MIRROR,
  };
  return map[key] || key;
};

/**
 * 根据停车位与最近行车道的相对位置，给出指向行车道的三元方向向量。
 * 约定：向右 [1,0,0]，向左 [-1,0,0]，向下 [0,1,0]，向上 [0,-1,0]
 */
export const inferParkingForward = (
  spot: LayoutElement,
  roads: LayoutElement[]
): [number, number, number] | undefined => {
  if (spot.type !== ElementType.PARKING_SPACE || roads.length === 0) return undefined;
  const sx = spot.x + spot.width / 2;
  const sy = spot.y + spot.height / 2;
  let best: { d: number; vec: [number, number, number] } | null = null;
  roads.forEach(r => {
    const rx = r.x + r.width / 2;
    const ry = r.y + r.height / 2;
    const dx = rx - sx;
    const dy = ry - sy;
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist === 0) return;
    let vec: [number, number, number];
    if (Math.abs(dx) >= Math.abs(dy)) {
      vec = dx >= 0 ? [1, 0, 0] : [-1, 0, 0];
    } else {
      vec = dy >= 0 ? [0, 1, 0] : [0, -1, 0];
    }
    if (!best || dist < best.d) best = { d: dist, vec };
  });
  return best?.vec;
};

/**
 * 将 AI 响应数据映射到内部布局格式
 */
export const mapToInternalLayout = (rawData: any): ParkingLayout => ({
  width: Number(rawData.width || 800),
  height: Number(rawData.height || 600),
  elements: (rawData.elements || []).map((e: any) => ({
    id: String(e.id || `el_${Math.random().toString(36).substr(2, 9)}`),
    type: normalizeType(e.type || e.t),
    x: Number(e.x || 0),
    y: Number(e.y || 0),
    width: Number(e.width || e.w || 10),
    height: Number(e.height || e.h || 10),
    rotation: Number(e.rotation || e.r || 0),
    label: e.label || e.l
  }))
});

/**
 * 后处理：坐标取整、添加填充
 */
export const postProcessLayout = (layout: ParkingLayout): ParkingLayout => {
  return {
    ...layout,
    elements: layout.elements.map(el => {
      const rx = Math.round(el.x);
      const ry = Math.round(el.y);
      const rw = Math.round(el.width);
      const rh = Math.round(el.height);
      
      const isStructural = [ElementType.ROAD, ElementType.GROUND, ElementType.WALL].includes(el.type as ElementType);
      const pad = isStructural ? 1 : 0; // 防止微小缝隙

      return {
        ...el,
        x: rx,
        y: ry,
        width: rw + pad,
        height: rh + pad
      };
    })
  };
};

export const mergeLayoutElements = (
  original: LayoutElement[], 
  updates: LayoutElement[]
): LayoutElement[] => {
  const elementMap = new Map(original.map(el => [el.id, el]));
  
  updates.forEach(update => {
    if (update.id && elementMap.has(update.id)) {
      const existing = elementMap.get(update.id)!;
      elementMap.set(update.id, { ...existing, ...update });
    } else {
      const newId = update.id || `el_${Math.random().toString(36).substr(2, 9)}`;
      elementMap.set(newId, { ...update, id: newId });
    }
  });

  return Array.from(elementMap.values());
};

export const calculateScore = (violations: ConstraintViolation[]): number => {
  return violations.reduce((acc, v) => {
    if (v.type === 'overlap') return acc + 5;
    if (v.type === 'connectivity_error') return acc + 10;
    if (v.type === 'out_of_bounds') return acc + 8;
    return acc + 2;
  }, 0);
};

// =============== 核心几何算法 (之前丢失的部分) ===============

/**
 * 自动填充停车位算法
 * 在道路(ROAD)和地块(GROUND)的交界处自动生成停车位
 */
export const fillParkingAutomatically = (layout: ParkingLayout): ParkingLayout => {
  const existingElements = [...layout.elements];
  const grounds = existingElements.filter(e => e.type === ElementType.GROUND);
  const roads = existingElements.filter(e => e.type === ElementType.ROAD);
  
  // 避障列表
  const obstacles = existingElements.filter(e => 
    [ElementType.WALL, ElementType.STAIRCASE, ElementType.ELEVATOR, ElementType.PILLAR,
     ElementType.ENTRANCE, ElementType.EXIT, ElementType.RAMP, ElementType.SAFE_EXIT,
     ElementType.SIDEWALK, ElementType.PARKING_SPACE].includes(e.type as ElementType)
  );
  
  const genSpots: LayoutElement[] = [];
  const SPOT_S = 24; // 车位宽
  const SPOT_L = 48; // 车位长
  const GAP = 2;     // 间隙
  const BUFFER = 4;  // 缓冲距离
  const TOLERANCE = 12; // 吸附容差

  const isSafe = (rect: {x: number, y: number, w: number, h: number}) => {
      const m = 1; 
      const hitObstacle = obstacles.some(o => 
        rect.x + m < o.x + o.width && rect.x + rect.w - m > o.x &&
        rect.y + m < o.y + o.height && rect.y + rect.h - m > o.y
      );
      const hitSelf = genSpots.some(o => 
        rect.x + m < o.x + o.width && rect.x + rect.w - m > o.x &&
        rect.y + m < o.y + o.height && rect.y + rect.h - m > o.y
      );
      return !hitObstacle && !hitSelf;
  };

  let t = 0; 

  roads.forEach(r => {
      const rr = { l: r.x, r: r.x + r.width, t: r.y, b: r.y + r.height };
      
      grounds.forEach(g => {
          const gr = { l: g.x, r: g.x + g.width, t: g.y, b: g.y + g.height };
          
          // Case A: Ground 在 Road 下方 (横向路)
          if (Math.abs(rr.b - gr.t) < TOLERANCE && Math.min(rr.r, gr.r) > Math.max(rr.l, gr.l)) {
               const sx = Math.max(rr.l, gr.l) + BUFFER;
               const ex = Math.min(rr.r, gr.r) - BUFFER;
               const cnt = Math.floor((ex - sx) / (SPOT_S + GAP)); 
               
               for(let i=0; i<cnt; i++) {
                   const s = { x: sx + i*(SPOT_S+GAP), y: gr.t + 1, w: SPOT_S, h: SPOT_L };
                   if (isSafe(s)) {
                       genSpots.push({ 
                           id: `p_auto_${++t}`, 
                           type: ElementType.PARKING_SPACE, 
                           x: s.x, y: s.y, width: s.w, height: s.h,
                           rotation: 0 
                       });
                   }
               }
          }
          // Case B: Ground 在 Road 上方
          else if (Math.abs(rr.t - gr.b) < TOLERANCE && Math.min(rr.r, gr.r) > Math.max(rr.l, gr.l)) {
              const sx = Math.max(rr.l, gr.l) + BUFFER;
              const ex = Math.min(rr.r, gr.r) - BUFFER;
              const cnt = Math.floor((ex - sx) / (SPOT_S + GAP));
              
              for(let i=0; i<cnt; i++) {
                   const s = { x: sx + i*(SPOT_S+GAP), y: gr.b - SPOT_L - 1, w: SPOT_S, h: SPOT_L };
                   if (isSafe(s)) {
                       genSpots.push({ 
                           id: `p_auto_${++t}`, 
                           type: ElementType.PARKING_SPACE, 
                           x: s.x, y: s.y, width: s.w, height: s.h,
                           rotation: 0 
                       });
                   }
              }
          }
          // Case C: Ground 在 Road 右侧 (纵向路)
          else if (Math.abs(rr.r - gr.l) < TOLERANCE && Math.min(rr.b, gr.b) > Math.max(rr.t, gr.t)) {
              const sy = Math.max(rr.t, gr.t) + BUFFER;
              const ey = Math.min(rr.b, gr.b) - BUFFER;
              const cnt = Math.floor((ey - sy) / (SPOT_S + GAP));

              for(let i=0; i<cnt; i++) {
                  const s = { x: gr.l + 1, y: sy + i*(SPOT_S+GAP), w: SPOT_L, h: SPOT_S };
                  if (isSafe(s)) {
                      genSpots.push({
                          id: `p_auto_v_${++t}`,
                          type: ElementType.PARKING_SPACE,
                          x: s.x, y: s.y, width: s.w, height: s.h,
                          rotation: 0
                      });
                  }
              }
          }
          // Case D: Ground 在 Road 左侧
          else if (Math.abs(rr.l - gr.r) < TOLERANCE && Math.min(rr.b, gr.b) > Math.max(rr.t, gr.t)) {
              const sy = Math.max(rr.t, gr.t) + BUFFER;
              const ey = Math.min(rr.b, gr.b) - BUFFER;
              const cnt = Math.floor((ey - sy) / (SPOT_S + GAP));

              for(let i=0; i<cnt; i++) {
                  const s = { x: gr.r - SPOT_L - 1, y: sy + i*(SPOT_S+GAP), w: SPOT_L, h: SPOT_S };
                  if (isSafe(s)) {
                      genSpots.push({
                          id: `p_auto_v_${++t}`,
                          type: ElementType.PARKING_SPACE,
                          x: s.x, y: s.y, width: s.w, height: s.h,
                          rotation: 0
                      });
                  }
              }
          }
      });
  });

  return { ...layout, elements: [...existingElements, ...genSpots] };
};

/**
 * 自动清理路口
 * 移除重叠在交叉路口的标线、减速带等
 */
export const cleanIntersections = (layout: ParkingLayout): ParkingLayout => {
    const roads = layout.elements.filter(e => e.type === ElementType.ROAD);
    let elementsToRemove = new Set<string>();

    for (let i = 0; i < roads.length; i++) {
        for (let j = i + 1; j < roads.length; j++) {
            const r1 = roads[i];
            const r2 = roads[j];
            const intersection = getIntersectionBox(r1, r2);

            if (intersection && intersection.width > 20 && intersection.height > 20) {
                const debris = layout.elements.filter(el => {
                    if (elementsToRemove.has(el.id)) return false;
                    const isDebrisType = [ElementType.LANE_LINE, ElementType.PARKING_SPACE, ElementType.SPEED_BUMP, ElementType.GUIDANCE_SIGN].includes(el.type as ElementType);
                    if (!isDebrisType) return false;
                    
                    const cx = el.x + el.width / 2;
                    const cy = el.y + el.height / 2;
                    return cx > intersection.x && cx < intersection.x + intersection.width &&
                           cy > intersection.y && cy < intersection.y + intersection.height;
                });
                debris.forEach(d => elementsToRemove.add(d.id));
            }
        }
    }

    if (elementsToRemove.size > 0) {
        return {
            ...layout,
            elements: layout.elements.filter(e => !elementsToRemove.has(e.id))
        };
    }
    return layout;
};

/**
 * 自动生成充电桩
 * 规则：每3个车位生成一个，且自动吸附到车位内部边缘
 */
export const generateChargingStations = (layout: ParkingLayout): ParkingLayout => {
    const spots = layout.elements.filter(e => e.type === ElementType.PARKING_SPACE);
    const roads = layout.elements.filter(e => e.type === ElementType.ROAD);
    const stations: LayoutElement[] = [];
    
    // 排序以保证生成规律性
    const sortedSpots = [...spots].sort((a, b) => {
        if (Math.abs(a.y - b.y) < 10) return a.x - b.x; 
        return a.y - b.y;
    });

    let stationCount = 0;
    const STATION_SIZE = 10;
    const OFFSET = 2; 

    sortedSpots.forEach((spot, index) => {
        if ((index + 1) % 3 === 0) { // 每3个生成1个
            const candidates = [
                { x: spot.x + spot.width/2 - STATION_SIZE/2, y: spot.y + OFFSET, side: 'top' },
                { x: spot.x + spot.width/2 - STATION_SIZE/2, y: spot.y + spot.height - STATION_SIZE - OFFSET, side: 'bottom' },
                { x: spot.x + OFFSET, y: spot.y + spot.height/2 - STATION_SIZE/2, side: 'left' },
                { x: spot.x + spot.width - STATION_SIZE - OFFSET, y: spot.y + spot.height/2 - STATION_SIZE/2, side: 'right' }
            ];

            const isVerticalSpot = spot.height > spot.width;
            let validCandidates = candidates.filter(c => {
                 if (isVerticalSpot) return c.side === 'top' || c.side === 'bottom';
                 return c.side === 'left' || c.side === 'right';
            });

            // 寻找离路最远的边（防止充电桩生成在路中间）
            let bestCandidate = validCandidates[0];
            let maxDistToRoad = -1;

            validCandidates.forEach(cand => {
                let minDistToRoad = Infinity;
                roads.forEach(r => {
                    const rcx = r.x + r.width / 2;
                    const rcy = r.y + r.height / 2;
                    const dist = Math.sqrt(Math.pow(cand.x - rcx, 2) + Math.pow(cand.y - rcy, 2));
                    if (dist < minDistToRoad) minDistToRoad = dist;
                });

                if (minDistToRoad > maxDistToRoad) {
                    maxDistToRoad = minDistToRoad;
                    bestCandidate = cand;
                }
            });

            if (bestCandidate) {
                stations.push({
                    id: `charging_${++stationCount}`,
                    type: ElementType.CHARGING_STATION,
                    x: bestCandidate.x,
                    y: bestCandidate.y,
                    width: STATION_SIZE,
                    height: STATION_SIZE,
                    rotation: 0
                });
            }
        }
    });

    return { ...layout, elements: [...layout.elements, ...stations] };
};

/**
 * 清理非法柱子
 * 移除生成在路中间或车位中间的柱子
 */
export const cleanupPillars = (layout: ParkingLayout): ParkingLayout => {
    const roads = layout.elements.filter(e => e.type === ElementType.ROAD);
    const spots = layout.elements.filter(e => e.type === ElementType.PARKING_SPACE);
    
    return {
        ...layout,
        elements: layout.elements.filter(el => {
            if (el.type !== ElementType.PILLAR) return true;
            
            const isOnRoad = roads.some(r => 
                el.x < r.x + r.width && el.x + el.width > r.x &&
                el.y < r.y + r.height && el.y + el.height > r.y
            );
            const isInsideSpot = spots.some(s => 
                el.x > s.x + 2 && el.x + el.width < s.x + s.width - 2 &&
                el.y > s.y + 2 && el.y + el.height < s.y + s.height - 2
            );

            return !isOnRoad && !isInsideSpot;
        })
    };
};

/**
 * 解决优先级冲突 (例如减速带不能和人行道重叠)
 */
export const resolvePriorityConflicts = (elements: LayoutElement[]): LayoutElement[] => {
    const sidewalks = elements.filter(e => e.type === ElementType.SIDEWALK);
    return elements.filter(el => {
        if (el.type === ElementType.SPEED_BUMP) {
            const hasConflict = sidewalks.some(s => {
                const intersection = getIntersectionBox(el, s);
                return intersection !== null && (intersection.width > 2 || intersection.height > 2);
            });
            return !hasConflict;
        }
        return true;
    });
};

/**
 * 调整指示牌方向
 */
export const orientGuidanceSigns = (layout: ParkingLayout): ParkingLayout => {
    const exits = layout.elements.filter(e => e.type === ElementType.EXIT);
    const roads = layout.elements.filter(e => e.type === ElementType.ROAD);
    if (exits.length === 0) return layout;

    const updated = layout.elements.map(el => {
        if (el.type === ElementType.GUIDANCE_SIGN) {
            const parentRoad = roads.find(r => 
                el.x >= r.x - 5 && el.x + el.width <= r.x + r.width + 5 &&
                el.y >= r.y - 5 && el.y + el.height <= r.y + r.height + 5
            );

            let nearestExit = exits[0], minDist = Infinity;
            const scx = el.x + el.width / 2;
            const scy = el.y + el.height / 2;

            exits.forEach(ex => {
                const ecx = ex.x + ex.width / 2;
                const ecy = ex.y + ex.height / 2;
                const d = Math.abs(ecx - scx) + Math.abs(ecy - scy);
                if (d < minDist) { minDist = d; nearestExit = ex; }
            });

            const ecx = nearestExit.x + nearestExit.width / 2;
            const ecy = nearestExit.y + nearestExit.height / 2;

            if (parentRoad) {
                const isHorizontal = parentRoad.width > parentRoad.height;
                if (isHorizontal) {
                    return { ...el, rotation: ecx > scx ? 0 : 180 };
                } else {
                    return { ...el, rotation: ecy > scy ? 90 : 270 };
                }
            }
            
            const dx = ecx - scx;
            const dy = ecy - scy;
            if (Math.abs(dx) > Math.abs(dy)) return { ...el, rotation: dx > 0 ? 0 : 180 };
            return { ...el, rotation: dy > 0 ? 90 : 270 };
        }
        return el;
    });
    return { ...layout, elements: updated };
};

/**
 * 几何增强主入口
 * 统一调用所有几何处理算法
 */
export const enhanceLayoutWithGeometry = async (
  layout: ParkingLayout,
  onLog?: (msg: string) => void
): Promise<ParkingLayout> => {
  let current = layout;

  onLog?.('📐 执行几何填充算法...');
  current = fillParkingAutomatically(current);

  onLog?.('🧹 清理交叉口...');
  current = cleanIntersections(current);

  onLog?.('⚡ 生成充电桩...');
  current = generateChargingStations(current);

  onLog?.('🧹 清理非法柱子...');
  current = cleanupPillars(current);

  // 再次清理交叉口以防万一
  current = cleanIntersections(current);

  onLog?.('⚖️ 解决优先级冲突...');
  current = { ...current, elements: resolvePriorityConflicts(current.elements) };

  onLog?.('🧭 调整指示牌方向...');
  current = orientGuidanceSigns(current);

  return current;
};
