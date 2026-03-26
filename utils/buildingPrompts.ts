import { LayoutElement, SceneDefinition } from '../types';

export const MASTER_PLANNER_PROMPT = (prompt: string) => `
You are the **Master Planner** of a multi-story building project.
Your task is to analyze the user's prompt and determine the number of floors and the purpose of each floor.

USER PROMPT: "${prompt}"

OUTPUT FORMAT:
Return a JSON object with the following structure:
{
  "floors": [
    { "id": "B1", "name": "B1", "sceneId": "parking_underground", "description": "e.g., Underground parking and ramps" },
    { "id": "1F", "name": "1F", "sceneId": "building_floor_plan", "description": "e.g., Lobby and Cafe" },
    { "id": "2F", "name": "2F", "sceneId": "building_floor_plan", "description": "e.g., Office space" }
  ]
}

STRICT RULES:
1. Respond with RAW JSON only. No markdown, no explanation.
2. For Building generation, always include one basement parking floor (B1) using sceneId "parking_underground".
3. All non-parking floors MUST use sceneId "building_floor_plan".
4. Limit to a maximum of 10 floors unless explicitly requested otherwise.
`;

export const CORE_ARCHITECT_PROMPT = (prompt: string, scene: SceneDefinition) => `
You are the **Core Architect**. Your task is to design the "Vertical Core" (Core筒) that will be identical across all floors of the building.
This core must include elevators, staircases, and main structural shear walls.

USER PROMPT: "${prompt}"
SCENE CONTEXT: ${scene.name}

REQUIRED ELEMENTS:
- ELEVATOR_SHAFT (elevator_shaft)
- STAIRCASE (staircase)
- SHEAR_WALL (shear_wall)

CANVAS: 800x600.

OUTPUT FORMAT:
Return a JSON object representing the layout elements of the core only.
{
  "elements": [
    { "id": "core_elevator_1", "t": "elevator_shaft", "x": 380, "y": 280, "w": 40, "h": 40 },
    { "id": "core_stairs_1", "t": "staircase", "x": 430, "y": 280, "w": 60, "h": 40 }
  ]
}

STRICT RULES:
1. These elements will be FROZEN and injected into every floor. Place them logically (usually near the center or a fixed side).
2. Respond with RAW JSON only.
`;

export const FLOOR_DRAFTSMAN_PROMPT = (
  floorPrompt: string,
  coreBlueprint: LayoutElement[],
  scene: SceneDefinition
) => {
  const coreElementsStr = JSON.stringify(coreBlueprint);
  
  return `
You are the **Floor Draftsman**. Your task is to design the internal layout for a specific floor.

FLOOR GOAL: "${floorPrompt}"
SCENE RULES: ${scene.promptConfig.geometricRules}

[CRITICAL CONSTRAINT: PRE-PLACED CORE ELEMENTS]
The following elements are ALREADY PLACED and are IMMUTABLE. 
You MUST include them in your output exactly as they are (same ID, type, position, and dimensions).
You must build the rest of the floor layout (rooms, walls, corridors) AROUND these elements.

CORE ELEMENTS:
${coreElementsStr}

OUTPUT FORMAT:
Return a COMPLETE JSON layout including the core elements and your new elements.
{
  "width": 800,
  "height": 600,
  "reasoning_plan": "...",
  "elements": [
    ... (include ALL core elements here) ...,
    { "id": "room_1", "t": "bedroom", "x": ..., "y": ..., "w": ..., "h": ... }
  ]
}

STRICT RULES:
1. DO NOT modify, move, or delete the CORE ELEMENTS.
2. All rooms must connect to the circulation system that leads to the core elements.
3. Respond with RAW JSON only.
`;
};
