/**
 * payments/credits.ts — Increment node credits after inference jobs (76 lines)
 *
 * Called by bucky daemon after each successful inference job.
 * POSTs to gateway /api/bucky/earnings/increment to update earnings.
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001';

/**
 * Increment credits for a node after completing inference jobs.
 * @param nodeId - Unique node identifier
 * @param amount - Credits to add (default: job complexity-based)
 * @param sats - Satoshis earned (default: 0 for now)
 * @param jobs - Number of jobs completed (default: 1)
 */
export async function incrementCredits(
  nodeId: string,
  amount: number = 1,
  sats: number = 0,
  jobs: number = 1
): Promise<void> {
  if (!nodeId) {
    throw new Error('[Credits] nodeId is required');
  }
  if (amount < 0 || sats < 0 || jobs < 0) {
    throw new Error('[Credits] negative values not allowed');
  }

  const url = `${GATEWAY_URL}/api/bucky/earnings/increment`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        node_id: nodeId,
        credits: amount,
        sats,
        jobs,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`[Credits] Gateway returned ${response.status}: ${error}`);
    }

    const result = await response.json();
    console.log('[Credits] Incremented:', {
      nodeId,
      credits: result.credits,
      sats: result.sats,
      jobs_served: result.jobs_served,
    });
  } catch (err: any) {
    console.error('[Credits] Failed to increment credits:', err.message);
    // Don't throw — earnings tracking is best-effort, shouldn't break inference
  }
}

/**
 * Get current earnings for a node.
 * @param nodeId - Unique node identifier
 * @returns Earnings data or null on error
 */
export async function getEarnings(nodeId: string): Promise<{
  node_id: string;
  credits: number;
  sats: number;
  jobs_served: number;
  updated_at: string;
} | null> {
  if (!nodeId) {
    throw new Error('[Credits] nodeId is required');
  }

  const url = `${GATEWAY_URL}/api/bucky/earnings/${encodeURIComponent(nodeId)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`[Credits] Gateway returned ${response.status}`);
    }
    return await response.json();
  } catch (err: any) {
    console.error('[Credits] Failed to get earnings:', err.message);
    return null;
  }
}
