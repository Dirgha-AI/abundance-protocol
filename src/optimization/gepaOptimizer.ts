export interface OptimizationTarget {
  id: string;
  type: 'prompt' | 'agent_config' | 'routing_policy' | 'task_pricing';
  current: string;
  evaluator: (candidate: string) => Promise<{ score: number; dimensions: Record<string, number>; trace: string }>;
}

export interface ParetoPoint {
  id: string;
  candidate: string;
  scores: Record<string, number>;
  dominated: boolean;
}

export interface GEPAConfig {
  maxIterations: number;
  populationSize: number;
  mutationRate: number;
  reflectionEnabled: boolean;
}

/**
 * GEPA (Genetic-Pareto) Optimizer implementing reflective evolution.
 * Loop: select → execute → reflect → mutate → accept
 */
export class GEPAOptimizer {
  private config: GEPAConfig;
  private frontier: ParetoPoint[] = [];
  private traces: Map<string, string> = new Map();
  private overallScores: Map<string, number> = new Map();

  /**
   * Creates a GEPA optimizer with specified configuration.
   * @param config Partial configuration to override defaults
   */
  constructor(config?: Partial<GEPAConfig>) {
    this.config = {
      maxIterations: 100,
      populationSize: 10,
      mutationRate: 0.3,
      reflectionEnabled: true,
      ...config
    };
  }

  /**
   * Runs the GEPA optimization loop.
   * @param target The optimization target with evaluator
   * @returns Best point, full frontier, and iteration count
   */
  async optimize(target: OptimizationTarget): Promise<{ best: ParetoPoint; frontier: ParetoPoint[]; iterations: number }> {
    // Initialize population with mutations of target.current
    for (let i = 0; i < this.config.populationSize; i++) {
      const candidate = this.mutate(target.current);
      const result = await target.evaluator(candidate);
      const point: ParetoPoint = {
        id: Math.random().toString(36).substr(2, 9),
        candidate,
        scores: result.dimensions,
        dominated: false
      };
      this.traces.set(point.id, result.trace);
      this.overallScores.set(point.id, result.score);
      this.updateFrontier(point);
    }

    // Evolution loop: select → execute → reflect → mutate → accept
    for (let iter = 0; iter < this.config.maxIterations; iter++) {
      const selected = this.selectFromFrontier(Math.max(1, Math.floor(this.config.populationSize / 2)));
      
      for (const parent of selected) {
        // Execute (retrieve stored execution data)
        const trace = this.traces.get(parent.id) ?? '';
        const score = this.overallScores.get(parent.id) ?? 0;
        
        // Reflect: analyze execution traces to diagnose failures
        let reflection: string | undefined;
        if (this.config.reflectionEnabled && score < 0.8) {
          reflection = this.reflect(trace, score);
        }
        
        // Mutate: generate improved candidate based on reflection
        const newCandidate = this.mutate(parent.candidate, reflection);
        
        // Execute new candidate to get scores for acceptance
        const newResult = await target.evaluator(newCandidate);
        const newPoint: ParetoPoint = {
          id: Math.random().toString(36).substr(2, 9),
          candidate: newCandidate,
          scores: newResult.dimensions,
          dominated: false
        };
        
        // Store metadata for future reflection
        this.traces.set(newPoint.id, newResult.trace);
        this.overallScores.set(newPoint.id, newResult.score);
        
        // Accept: update Pareto frontier with non-dominated solutions
        this.updateFrontier(newPoint);
      }
    }

    return {
      best: this.getBest(),
      frontier: this.getFrontier(),
      iterations: this.config.maxIterations
    };
  }

  /**
   * Tournament selection from non-dominated frontier points.
   * @param count Number of parents to select
   * @returns Selected Pareto points
   */
  private selectFromFrontier(count: number): ParetoPoint[] {
    const nonDominated = this.frontier.filter(p => !p.dominated);
    if (nonDominated.length === 0) return [];
    
    const selected: ParetoPoint[] = [];
    for (let i = 0; i < count; i++) {
      const a = nonDominated[Math.floor(Math.random() * nonDominated.length)];
      const b = nonDominated[Math.floor(Math.random() * nonDominated.length)];
      
      if (this.isDominated(a.scores, b.scores)) {
        selected.push(b);
      } else if (this.isDominated(b.scores, a.scores)) {
        selected.push(a);
      } else {
        selected.push(Math.random() > 0.5 ? a : b);
      }
    }
    return selected;
  }

  /**
   * Simple string mutation with optional reflection guidance.
   * @param candidate Input string
   * @param reflection Optional reflection insight to guide mutation
   * @returns Mutated string
   */
  private mutate(candidate: string, reflection?: string): string {
    if (reflection) {
      return `[${reflection}] ${candidate}`;
    }
    
    const words = candidate.split(' ');
    if (words.length > 1 && Math.random() < this.config.mutationRate) {
      const i = Math.floor(Math.random() * words.length);
      const j = Math.floor(Math.random() * words.length);
      [words[i], words[j]] = [words[j], words[i]];
    }
    
    if (Math.random() < this.config.mutationRate && words.length > 0) {
      const idx = Math.floor(Math.random() * words.length);
      words[idx] = words[idx].split('').reverse().join('');
    }
    
    return words.join(' ');
  }

  /**
   * Analyze execution trace to diagnose scoring failures.
   * @param trace Execution trace string
   * @param score Overall score value
   * @returns Reflection insight string
   */
  private reflect(trace: string, score: number): string {
    if (score < 0.3) return 'critical_restructure_needed';
    if (trace.includes('error') || trace.includes('fail')) return 'error_handling_required';
    if (trace.includes('timeout') || trace.includes('slow')) return 'performance_optimization';
    if (score < 0.6) return 'clarity_improvement';
    return 'fine_tuning';
  }

  /**
   * Update frontier with new point, removing dominated solutions.
   * @param newPoint Candidate point to potentially add
   * @returns True if point was accepted (non-dominated)
   */
  private updateFrontier(newPoint: ParetoPoint): boolean {
    for (const point of this.frontier) {
      if (!point.dominated && this.isDominated(newPoint.scores, point.scores)) {
        newPoint.dominated = true;
        return false;
      }
    }
    
    this.frontier = this.frontier.filter(point => {
      if (this.isDominated(point.scores, newPoint.scores)) {
        this.traces.delete(point.id);
        this.overallScores.delete(point.id);
        return false;
      }
      return true;
    });
    
    this.frontier.push(newPoint);
    return true;
  }

  /**
   * Check if solution a is dominated by solution b.
   * Assumes maximization: b dominates a if b >= a in all dimensions and > in at least one.
   * @param a Scores of solution a
   * @param b Scores of solution b
   * @returns True if a is dominated by b
   */
  private isDominated(a: Record<string, number>, b: Record<string, number>): boolean {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    let strictlyBetter = false;
    
    for (const key of keys) {
      const aVal = a[key] ?? 0;
      const bVal = b[key] ?? 0;
      if (bVal < aVal) return false;
      if (bVal > aVal) strictlyBetter = true;
    }
    
    return strictlyBetter;
  }

  /**
   * Get current non-dominated Pareto frontier.
   * @returns Array of non-dominated points
   */
  getFrontier(): ParetoPoint[] {
    return this.frontier.filter(p => !p.dominated);
  }

  /**
   * Get best point from frontier.
   * @param dimension Optional specific dimension to maximize
   * @returns Best Pareto point
   */
  getBest(dimension?: string): ParetoPoint {
    const candidates = this.getFrontier();
    if (candidates.length === 0) {
      return { id: 'none', candidate: '', scores: {}, dominated: false };
    }
    
    if (dimension) {
      return candidates.reduce((best, curr) => 
        (curr.scores[dimension] ?? 0) > (best.scores[dimension] ?? 0) ? curr : best
      );
    }
    
    return candidates.reduce((best, curr) => {
      const currSum = Object.values(curr.scores).reduce((sum, v) => sum + (v ?? 0), 0);
      const bestSum = Object.values(best.scores).reduce((sum, v) => sum + (v ?? 0), 0);
      return currSum > bestSum ? curr : best;
    });
  }
}

/**
 * Factory function to create GEPA optimizer.
 * @param config Optional configuration overrides
 * @returns Configured GEPAOptimizer instance
 */
export function createGEPAOptimizer(config?: Partial<GEPAConfig>): GEPAOptimizer {
  return new GEPAOptimizer(config);
}
