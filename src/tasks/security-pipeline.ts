// Sprint 5: Arniko security pipeline integration
// Runs security scan before task assignment

import { arnikoBridge } from '../bridge/arniko-bridge.js';
import { globalBus } from '../shared/event-bus.js';

export async function runSecurityPipeline(taskId: string, code: string): Promise<any> {
  console.log(`[SecurityPipeline] Task ${taskId} starting security scan...`);
  
  // 1. Run Arniko security scan
  const scanResult = await arnikoBridge.scanCode(code, taskId);
  
  // 2. Block if critical findings
  if (!scanResult.passed) {
    console.log(`[SecurityPipeline] ❌ Task ${taskId} BLOCKED - security findings`);
    
    await globalBus.publish({
      type: 'task.blocked',
      source: 'arniko',
      payload: { taskId, reason: 'security_findings', scanResult }
    });
    
    return { allowed: false, scanResult };
  }
  
  // 3. Allow if passed
  console.log(`[SecurityPipeline] ✅ Task ${taskId} PASSED security`);
  
  await globalBus.publish({
    type: 'task.secure',
    source: 'arniko',
    payload: { taskId, scanResult }
  });
  
  return { allowed: true, scanResult };
}

export default runSecurityPipeline;
