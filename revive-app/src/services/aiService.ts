/**
 * AI Service - Provider Abstraction Layer
 * 
 * This layer abstracts AI provider selection and model routing.
 * Phase 2A: Mock responses only (no paid API)
 * Future: Connect to Claude, GPT-4, or other providers via orchestration
 */

export type AIProvider = 'claude' | 'gpt4' | 'mock';
export type AITask = 'research' | 'reasoning' | 'analysis' | 'generation';

export interface AIResponse {
  content: string;
  provider: AIProvider;
  tokensUsed?: number;
  confidenceScore?: number;
}

interface AIRequest {
  task: AITask;
  prompt: string;
  context?: Record<string, unknown>;
  preferredProvider?: AIProvider;
}

/**
 * Abstract provider selection based on task requirements
 */
function selectProvider(task: AITask, preferred?: AIProvider): AIProvider {
  // Phase 2A: Always return 'mock'
  // Future logic:
  // - For reasoning-heavy: prefer Claude
  // - For speed: prefer GPT-4o mini
  // - For cost optimization: prefer cheaper model
  // - For availability: fallback chain
  if (preferred === 'mock' || task) return 'mock';
  return 'mock';
}

/**
 * Get mocked response for Phase 2A
 */
function getMockResponse(task: AITask, prompt: string): string {
  const taskResponses: Record<AITask, (prompt: string) => string> = {
    research: () => `Research Analysis: Identified key market opportunities and competitive positioning based on provided context. [MOCKED - Phase 2A]`,
    reasoning: () => `REV Analysis: Based on available information, the recommended approach would prioritize high-engagement opportunities. [MOCKED - Phase 2A]`,
    analysis: () => `Data Analysis: Patterns suggest correlation between engagement timing and conversion rates. [MOCKED - Phase 2A]`,
    generation: () => `Generated Content: [Your personalized message here] [MOCKED - Phase 2A]`,
  };

  return taskResponses[task]?.(prompt) || `AI Response (${task}) [MOCKED - Phase 2A]`;
}

/**
 * Main AI Service interface
 */
export const AIService = {
  /**
   * Make a reasoning request to configured AI provider
   */
  async reason(prompt: string, _context?: Record<string, unknown>): Promise<AIResponse> {
    const provider = selectProvider('reasoning');

    if (provider === 'mock') {
      return {
        content: getMockResponse('reasoning', prompt),
        provider: 'mock',
        confidenceScore: 0.85,
      };
    }

    // Future: Actual provider call
    throw new Error(`Provider ${provider} not yet implemented`);
  },

  /**
   * Make a research/analysis request
   */
  async analyze(prompt: string, _context?: Record<string, unknown>): Promise<AIResponse> {
    const provider = selectProvider('analysis');

    if (provider === 'mock') {
      return {
        content: getMockResponse('analysis', prompt),
        provider: 'mock',
        confidenceScore: 0.80,
      };
    }

    throw new Error(`Provider ${provider} not yet implemented`);
  },

  /**
   * Generate content (emails, messages, etc.)
   */
  async generate(prompt: string, _context?: Record<string, unknown>): Promise<AIResponse> {
    const provider = selectProvider('generation');

    if (provider === 'mock') {
      return {
        content: getMockResponse('generation', prompt),
        provider: 'mock',
        confidenceScore: 0.88,
      };
    }

    throw new Error(`Provider ${provider} not yet implemented`);
  },

  /**
   * Make a generic AI request
   */
  async request(request: AIRequest): Promise<AIResponse> {
    const provider = selectProvider(request.task, request.preferredProvider);

    if (provider === 'mock') {
      return {
        content: getMockResponse(request.task, request.prompt),
        provider: 'mock',
        confidenceScore: 0.82,
      };
    }

    throw new Error(`Provider ${provider} not yet implemented`);
  },

  /**
   * Get available providers (for future provider selection UI)
   */
  getAvailableProviders(): AIProvider[] {
    // Phase 2A: Only mock available
    // Future: ['claude', 'gpt4', 'mock']
    return ['mock'];
  },

  /**
   * Check if a provider is configured
   */
  isProviderConfigured(provider: AIProvider): boolean {
    return provider === 'mock'; // Phase 2A
  },
};
