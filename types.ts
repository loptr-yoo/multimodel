export enum ElementType {
  GROUND = 'ground',
  PARKING_SPACE = 'parking_space',
  ROAD = 'driving_lane', // Renamed for clarity based on prompt, mapped from 'road'
  SIDEWALK = 'pedestrian_path', // Renamed for clarity
  RAMP = 'slope',
  PILLAR = 'pillar',
  WALL = 'wall',
  ENTRANCE = 'entrance',
  EXIT = 'exit',
  STAIRCASE = 'staircase',
  ELEVATOR = 'elevator',
  CHARGING_STATION = 'charging_station',
  GUIDANCE_SIGN = 'guidance_sign',
  SAFE_EXIT = 'safe_exit',
  SPEED_BUMP = 'deceleration_zone',
  FIRE_EXTINGUISHER = 'fire_extinguisher',
  LANE_LINE = 'ground_line',
  CONVEX_MIRROR = 'convex_mirror'
}

export interface LayoutElement {
  id: string;
  type: ElementType | string; // Allow string for backward compatibility/flexibility
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number; // Degrees
  label?: string;
  subType?: string; // For things like 'lane_line' direction
  forward?: [number, number, number]; // 车位指向行车道的方向向量，右/下/上/左为主轴
}

export interface ParkingLayout {
  width: number;
  height: number;
  elements: LayoutElement[];
}

export interface ConstraintViolation {
  elementId: string;
  targetId?: string; // If colliding with another element
  type: 'overlap' | 'out_of_bounds' | 'invalid_dimension' | 'placement_error' | 'connectivity_error' | 'width_mismatch';
  message: string;
}

export interface ElementStyle {
  fill: string;
  opacity: number;
  stroke?: string;
  strokeWidth?: number;
  rx?: number;
}

export interface DrawerContext {
  layout: ParkingLayout;
  violations: ConstraintViolation[];
}

export type ElementDrawer = (
  g: any,
  element: LayoutElement,
  style: ElementStyle,
  context: DrawerContext
) => void;

export type LayoutAlgorithm = (layout: ParkingLayout) => ParkingLayout;

export interface SceneDefinition {
  id: string;
  name: string;
  description: string;
  promptConfig: {
    roleDefinition: string;
    geometricRules: string;
    requiredElements: string[];
    exampleJSON: string;
  };
  styles: Record<string, ElementStyle>;
  customDrawers?: Record<string, ElementDrawer>;
  zOrder?: string[];
  elementNormalization?: Record<string, string>;
  postProcessAlgorithms?: LayoutAlgorithm[];
}
