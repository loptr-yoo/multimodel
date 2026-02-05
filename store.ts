import { create } from 'zustand';
import { ParkingLayout, ConstraintViolation } from './types';
import { AIProvider } from './utils/aiConfig';

interface AppState {
  layout: ParkingLayout | null;
  violations: ConstraintViolation[];
  isGenerating: boolean;
  error: string | null;
  logs: string[];
  generationTime: number | null;
  
  // AI 模型相关
  selectedProvider: AIProvider;
  selectedModel: string;
  availableModels: Array<{ id: string; name: string; provider: AIProvider }>;

  // Actions
  setLayout: (layout: ParkingLayout | null) => void;
  setViolations: (violations: ConstraintViolation[]) => void;
  setIsGenerating: (isGenerating: boolean) => void;
  setError: (error: string | null) => void;
  addLog: (msg: string) => void;
  clearLogs: () => void;
  setGenerationTime: (time: number | null) => void;
  setSelectedProvider: (provider: AIProvider) => void;
  setSelectedModel: (model: string) => void;
}

export const useStore = create<AppState>((set) => ({
  layout: null,
  violations: [],
  isGenerating: false,
  error: null,
  logs: [],
  generationTime: null,
  selectedProvider: 'gemini' as AIProvider,
  selectedModel: 'gemini-2.5-pro',
  availableModels: [],

  setLayout: (layout) => set({ layout }),
  setViolations: (violations) => set({ violations }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  setError: (error) => set({ error }),
  addLog: (msg) => set((state) => ({ logs: [...state.logs, msg] })),
  clearLogs: () => set({ logs: [] }),
  setGenerationTime: (time) => set({ generationTime: time }),
  setSelectedProvider: (provider) => set({ selectedProvider: provider }),
  setSelectedModel: (model) => set({ selectedModel: model }),
}));