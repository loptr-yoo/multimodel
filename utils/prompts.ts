import { ParkingLayout, ConstraintViolation } from '../types';

const PROTOCOLS = {
  FULL_STATE: `
 ## OUTPUT FORMAT: FULL STATE 
 - Return the COMPLETE JSON object with ALL elements. 
 - DO NOT use partial updates. 
 `,
  PATCH_ONLY: `
 ## OUTPUT FORMAT: INCREMENTAL PATCH (CRITICAL) 
 - You are operating in **Low-Bandwidth Mode**. 
 - **DO NOT** return the full JSON. 
 - **ONLY** return the elements that you modified, added, or moved. 
 - Use the structure: { "modified_elements": [...], "deleted_ids": [...] } 
 - If you change a wall's length, return the object with the SAME ID and new 'width'. 
 - Maintain ID CONSISTENCY: Never rename existing element IDs. Use the SAME ID for modifications. 
 - If you create NEW elements, include them under "new_elements"; do not mix with "modified_elements". 
 - STRICT OUTPUT: Respond with RAW JSON only. No Markdown, no code fences, no explanatory text. 
 - REQUIRED KEYS: Use exactly "modified_elements" and "deleted_ids" for patches. 
 `
};

const ROLES = {
  GENERATOR: `
 ## YOUR ROLE: Visionary Architect 
 You are a senior spatial designer. Your goal is to create a layout from scratch. 
 Focus on creativity, flow, and spatial utilization. 
 `,
  OPTIMIZER: `
 ## YOUR ROLE: Detail-Oriented Engineer 
 You are a facility optimization expert. The layout already exists. 
 Your goal is to ADD facilities (stairs, elevators) without breaking the existing structure. 
 Focus on precision and compliance. 
 `,
  FIXER: `
 ## YOUR ROLE: Strict Compliance Officer (Debugger) 
 You are a code logic validator. You DO NOT design; you ONLY fix violations. 
 Your goal is to resolve overlaps and invalid placements surgically. 
 Be minimal and non-destructive. 
 `
};

export const PROMPTS = {
  // 通用系统提示（用于 DeepSeek、OpenAI 等）
  systemPrompt: () => `You are an expert parking lot designer with extensive experience in spatial planning.

Generate a detailed parking lot layout as JSON. Your response MUST be ONLY valid JSON, nothing else.

Your response must follow this exact structure:
{
  "width": number (e.g., 800),
  "height": number (e.g., 600),
  "reasoning_plan": "STRICTLY UNDER 30 WORDS. Summary of strategy only.",
  "elements": [
    {
      "id": "unique_identifier",
      "type": "GROUND" | "ROAD" | "PARKING_SPACE" | "SIDEWALK" | "WALL" | "ENTRANCE" | "EXIT" | "PILLAR" | "RAMP" | "STAIRCASE" | "ELEVATOR" | "CHARGING_STATION" | "GUIDANCE_SIGN" | "SAFE_EXIT" | "SPEED_BUMP" | "FIRE_EXTINGUISHER" | "LANE_LINE" | "CONVEX_MIRROR",
      "x": number,
      "y": number,
      "width": number,
      "height": number,
      "rotation": number (0-360, optional),
      "label": "descriptive text" (optional)
    }
  ]
}

CRITICAL RULES:
1. ALL parking spaces must have type "PARKING_SPACE"
2. ALL roads/lanes must have type "ROAD"
3. Width and height must be positive numbers > 0
4. X and Y coordinates must be within layout bounds
5. Do NOT include any explanatory text before or after the JSON
6. Start with { and end with } directly
7. All element types must be from the list above

Design principles:
- Maximize parking efficiency
- Ensure clear traffic flow
- Separate entrance and exit clearly
- Include pedestrian paths
- Place support infrastructure logically`,

  generation: (description: string) => `
  You are an **Architectural Spatial Planner**. 
  Generate a COARSE-GRAINED JSON underground parking layout (0,0 at top-left) for: "${description}".
  
  **CANVAS CONSTRAINTS**: Width: 800, Height: 600.
  
  **CRITICAL GEOMETRIC RULES**:
  1. **CLOSED LOOP PERIMETER**: Walls MUST overlap or touch at corners. NO perimeter gaps.
  2. **The "Racetrack" Pattern**:
     - Create a main loop of 'driving_lane' (Roads).
     - **MANDATORY SETBACK**: The Road Loop must be **INSET** from the perimeter walls.
  3. **'ground' Elements (CRITICAL FOR VOID FIXING)**:
     - **NO FLOATING ISLANDS**: Every 'ground' element MUST touch a 'driving_lane' or another 'ground' on all sides.
     - **INTERNAL FILL**: The empty space INSIDE the road loop (the "donut hole") must be **100% FILLED** with 'ground' strips.
     - **STRIP LOGIC**: If splitting the center into multiple 'ground' strips, they must **TOUCH** (e.g., y of Strip B = y + height of Strip A). **DO NOT leave black gaps between strips.**
  4. **Boundary Snapping**:
     - 'entrance' and 'exit' MUST touch the edges of the canvas.
  5. **ZERO-VOID POLICY**:
     - The final layout must look like a **Solid Mosaic**. 
     - Visible Background Color = ERROR. 
     - Any space not occupied by a 'wall' or 'driving_lane' MUST be covered by 'ground'.
  
  **TOKEN SAVING INSTRUCTION**: 
  - The JSON response will be cut off if it is too long. 
  - **KEEP 'reasoning_plan' EXTREMELY SHORT (Max 1 sentence).**
  - Devote all tokens to generating the 'elements' list.

  **REQUIRED ELEMENTS**:
  - 'wall': Perimeter boundaries.
  - 'driving_lane': Main vehicle arteries (Width ~60).
  - 'ground': Parking islands (Must fill all voids).
  - 'entrance' / 'exit': 40x20 blocks on boundary.
  - 'slope': 40x60 connectors joining Entrance/Exit to Roads.

  **JSON EXAMPLE**:
  \`\`\`json
  {
    "reasoning_plan": "Racetrack road with solid central island ground strips touching each other.",
    "width": 800, "height": 600,
    "elements": [
      {"t": "wall", "x": 0, "y": 0, "w": 800, "h": 20},
      {"t": "driving_lane", "x": 60, "y": 60, "w": 680, "h": 60},
      {"t": "ground", "x": 120, "y": 120, "w": 560, "h": 100}, 
      {"t": "ground", "x": 120, "y": 220, "w": 560, "h": 100} 
    ]
  }
  \`\`\`
  // Note in example: y:220 is exactly y:120 + h:100. They touch.
  `,

  refinement: (simplifiedLayout: any, width: number, height: number) => `
    You are a **Spatial Algorithm Engine**.
    Task: Inject NEW detailed structural and facility elements into the existing layout.

    **INPUT DATA**: 
    - Canvas: ${width}x${height}
    - Existing Elements: 
    ${JSON.stringify(simplifiedLayout.elements)}

    **CRITICAL DESIGN RULES**:
    - **FACILITY PLACEMENT**: 'staircase', 'elevator', and 'safe_exit' MUST be placed on 'ground' elements. They are FORBIDDEN from being on 'driving_lane'.
    - **SPEED BUMP ORIENTATION**: 'deceleration_zone' must be PERPENDICULAR to the road direction.
    - **SIDEWALK LOGIC**: 'pedestrian_path' must cross the 'driving_lane' to connect 'ground' areas.

    **SYSTEM ARCHITECTURE (TOKEN SAVING)**:
    - **Algorithmic Spot Filler**: Do NOT generate 'parking_space'. My algorithm will fill them later.
    - **Focus**: Only generate 'pillar', 'ground_line', 'guidance_sign', 'staircase', 'elevator', 'safe_exit', 'pedestrian_path'.

    **INCREMENTAL OUTPUT MODE (CRITICAL)**:
    - **DO NOT** return the existing 'wall', 'driving_lane', or 'ground' elements provided in INPUT.
    - **ONLY** return the **NEW** elements you are creating in this step.

    **GENERATION TASKS**:
    1. **Layer 1: Structural Grid ('pillar')**
       - Place 'pillar' (size 10x10) at corners of 'ground' areas.
       - Max 1 pillar every 100-150 units. Sparsity is key.
       - Pillars provide structural integrity to the parking islands.
    2. **Layer 2: Road Logic**
       - 'ground_line': Dashed lines (width 2) in center of 'driving_lane' areas.
       - 'guidance_sign': (10x10) at road junctions to indicate Exit direction.
       - 'deceleration_zone': (10x40) Place near Entrances/Exits.

    3. **Layer 3: Pedestrian Paths ('pedestrian_path')**
       - Draw zebra crossings connecting 'ground' areas across roads.
    4. **Layer 4: Facilities**
       - 'staircase' (30x30) + 'safe_exit' (20x20) placed together on 'ground' areas near the corners.
       - 'elevator' (20x20), 'fire_extinguisher' (10x10) spread out.

    **OUTPUT JSON FORMAT**:
    {
      "reasoning_plan": "Added [X] pillars and [Y] signs...",
      "new_elements": [
         { "t": "pillar", "x": 100, "y": 100, "w": 10, "h": 10 },
         { "t": "ground_line", "x": ..., "y": ..., "w": ..., "h": ... }
      ]
    }
  `,

  fix: (layout: ParkingLayout, violations: ConstraintViolation[]) => `
    ${ROLES.FIXER}
    ${PROTOCOLS.PATCH_ONLY}
    You are a **Topological Constraint Solver**.
    
    **INPUT**: ${layout.width}x${layout.height} Canvas.
    **VIOLATIONS**: ${JSON.stringify(violations)}

    **CRITICAL RULES**:
    1. **ZERO-VOID / GAP FILLING**: 
       - Any narrow gap between a 'driving_lane' and a 'wall' (or another road) MUST be filled by **EXTENDING THE GROUND**, NOT by creating a new road.
       - **Action**: If you see a small gap, resize the adjacent 'ground' to touch the road. **NEVER SHRINK** 'ground' elements to fix overlaps with 'driving_lane' or 'wall' if it creates gaps.
    
    2. **FACILITY PLACEMENT**:
       - 'staircase', 'elevator', 'safe_exit' MUST sit on 'ground'.
       - They CANNOT float in 'driving_lane' or empty space.
       - They CANNOT overlap with pillars or each other.

    3. **CLEAN INTERSECTIONS**:
       - Road junctions (where two roads overlap) must be EMPTY.
       - **DELETE** any 'ground_line', 'parking_space', or 'guidance_sign' caught inside a road intersection.

    **HIERARCHY OF TRUTH**:
    1. **Immutable**: Walls, Roads, Entrances/Exits.
    2. **Flexible**: Ground (Resize to SNAP to roads/walls).
    3. **Disposable**: Parking Spaces / Pillars (Delete if bad).

    **SURGICAL EXECUTION PLAN**:
    - **Gap Fix**: Resize Ground_ID to fill gap.
    - **Intersection Clean**: Delete Element_ID inside junction.
    - **Placement Fix**: Move Facility_ID onto nearest Ground.

    **INCREMENTAL OUTPUT MODE (CRITICAL)**:
    - **DO NOT** return the full JSON. It is too large and will be truncated.
    - **ONLY** return the elements that you actually MODIFIED, RESIZED, or MOVED.
    - If you resize a ground block, return ONLY that specific ground block with new coordinates.
    - If you delete an element, do not return it (I will handle missing IDs). 
    
    **OUTPUT JSON FORMAT**: 
    {
      "reasoning_plan": "Fixed [X] violations by resizing [ID].",
      "modified_elements": [
         { "id": "id_1", "t": "...", "x": ..., "y": ..., "w": ..., "h": ... }
      ]
    }
  `,
  generateSystemPrompt: (description: string) => `
 ${ROLES.GENERATOR}
 ${PROTOCOLS.FULL_STATE}
 ${PROMPTS.generation(description)}
 `,
  optimizeSystemPrompt: (simplifiedLayout: any, width: number, height: number) => `
 ${ROLES.OPTIMIZER}
 ${PROTOCOLS.PATCH_ONLY}
 ${PROMPTS.refinement(simplifiedLayout, width, height)}
 `,
  fixSystemPrompt: (layout: ParkingLayout, violations: ConstraintViolation[]) => `
 ${ROLES.FIXER}
 ${PROTOCOLS.PATCH_ONLY}
 ${PROMPTS.fix(layout, violations)}
 `,
  fixPrompt: (violations: any[]) => `
 CONTEXT: The current layout has logical errors. 
 VIOLATIONS: ${JSON.stringify(violations)} 
 
 MISSION: 
 1. Analyze the specific IDs involved in the violations. 
 2. Apply the MINIMAL changes needed to resolve them (e.g., slight resize or move). 
 3. **DO NOT regenerate the whole map.** Only output the specific elements you touched. 
 
 REMEMBER: You are the "Compliance Officer". Do not redesign the parking lot. Just fix the bugs. 
 
 ${PROTOCOLS.PATCH_ONLY}
 `
};
