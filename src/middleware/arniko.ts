import { arnikoBridge } from '../bridge/arniko-bridge.js';
import { globalBus } from '../shared/event-bus.js';
// @ts-ignore
import { IntentFirewall } from '../../../../packages/core/src/security/intent-firewall.js';

const intentFirewall = new IntentFirewall();

export interface ArnikoMiddlewareConfig {
  autoQuarantine: boolean;
  riskThreshold?: number;
}

export function createArnikoMiddleware(config: ArnikoMiddlewareConfig) {
  return {
    async onTaskInput(taskId: string, content: string, userGoal: string = 'compute'): Promise<{ allowed: boolean; reason?: string }> {
      // 1. Semantic Intent Audit (SOTA v2.0)
      const audit = await intentFirewall.validateAction(userGoal, 'task_input', { content });
      if (!audit.allowed) {
        console.error(`[Arniko] Intent Blocked: ${audit.reason}`);
        return { allowed: false, reason: audit.reason };
      }

      // 2. Standard Pattern Scan
      const result = await arnikoBridge.scanCode(content, taskId);
      if (!result.passed) {
        globalBus.publish({
          type: 'task.blocked',
          source: 'arniko',
          payload: { taskId, reason: 'security_findings', findingsCount: result.findings.length }
        });
      }
      return { allowed: result.passed, reason: result.passed ? undefined : 'Security scan failed' };
    },
    async onTaskOutput(taskId: string, output: string): Promise<{ output: string; flagged: boolean; maturityScore: number }> {
      const result = await arnikoBridge.scanCode(output, taskId + '-output');
      if (!result.passed && config.autoQuarantine) {
        globalBus.publish({
          type: 'task.quarantined',
          source: 'arniko',
          payload: { taskId }
        });
      }
      return { output, flagged: !result.passed, maturityScore: result.maturityScore };
    }
  };
}

export default createArnikoMiddleware;
