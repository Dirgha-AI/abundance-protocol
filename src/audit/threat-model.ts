export interface ThreatFinding {
  id: string;
  severity: 'critical'|'high'|'medium'|'low';
  category: string;
  description: string;
  mitigation: string;
  affected: string;
}

class ThreatModelScanner {
  scanEndpoints(routes: string[]): ThreatFinding[] {
    const findings: ThreatFinding[] = [];
    let counter = 1;

    for (const route of routes) {
      const lowerRoute = route.toLowerCase();

      const authPatterns = ['auth', 'protected', 'private', 'jwt', 'token'];
      const hasAuth = authPatterns.some(pattern => lowerRoute.includes(pattern));
      if (!hasAuth) {
        findings.push({
          id: `ENDPOINT-${String(counter).padStart(3, '0')}`,
          severity: 'high',
          category: 'Authentication',
          description: `Route "${route}" lacks explicit authentication patterns (auth, protected, private, jwt, token)`,
          mitigation: 'Implement authentication middleware using JWT or session tokens. Add route guards to verify user identity before processing requests.',
          affected: route
        });
        counter++;
      }

      const injectionPatterns = ['query', 'search', 'filter', 'exec'];
      if (injectionPatterns.some(pattern => lowerRoute.includes(pattern))) {
        findings.push({
          id: `ENDPOINT-${String(counter).padStart(3, '0')}`,
          severity: 'critical',
          category: 'Injection',
          description: `Route "${route}" contains potential SQL/command injection vectors (query, search, filter, exec patterns detected)`,
          mitigation: 'Use parameterized queries and prepared statements. Implement input validation and sanitization. Avoid dynamic query construction.',
          affected: route
        });
        counter++;
      }

      const ssrfPatterns = ['url', 'fetch', 'proxy', 'redirect', 'webhook'];
      if (ssrfPatterns.some(pattern => lowerRoute.includes(pattern))) {
        findings.push({
          id: `ENDPOINT-${String(counter).padStart(3, '0')}`,
          severity: 'high',
          category: 'SSRF',
          description: `Route "${route}" may be vulnerable to Server-Side Request Forgery (URL, fetch, proxy, redirect, or webhook patterns detected)`,
          mitigation: 'Validate and sanitize all user-supplied URLs. Use allowlists for outbound requests. Disable URL redirects or validate destination schemes.',
          affected: route
        });
        counter++;
      }

      const idorPatterns = [':id', ':userid', ':nodeid'];
      if (idorPatterns.some(pattern => lowerRoute.includes(pattern))) {
        findings.push({
          id: `ENDPOINT-${String(counter).padStart(3, '0')}`,
          severity: 'high',
          category: 'IDOR',
          description: `Route "${route}" uses parameterized IDs (:id, :userId, :nodeId) without explicit authorization checks`,
          mitigation: 'Implement authorization checks to verify the requesting user has permission to access the specified resource. Use indirect reference maps if possible.',
          affected: route
        });
        counter++;
      }
    }

    return findings;
  }

  scanPaymentFlow(lightningConfig: any): ThreatFinding[] {
    const findings: ThreatFinding[] = [];
    let counter = 1;

    if (!lightningConfig?.idempotencyKey && !lightningConfig?.idempotency) {
      findings.push({
        id: `PAYMENT-${String(counter).padStart(3, '0')}`,
        severity: 'critical',
        category: 'Payment Integrity',
        description: 'No idempotency key mechanism detected in Lightning configuration. Vulnerable to invoice replay attacks where the same payment can be processed multiple times.',
        mitigation: 'Implement idempotency keys for all payment operations. Store processed keys in a distributed cache with TTL matching invoice expiry.',
        affected: 'Lightning Payment Processing'
      });
      counter++;
    }

    if (!lightningConfig?.distributedLock && !lightningConfig?.lockingMechanism) {
      findings.push({
        id: `PAYMENT-${String(counter).padStart(3, '0')}`,
        severity: 'high',
        category: 'Concurrency',
        description: 'Missing distributed locking mechanism in payment flow. Race conditions may allow double-spending or duplicate payment processing in concurrent scenarios.',
        mitigation: 'Implement distributed locks using Redis or similar. Use atomic operations for balance updates. Implement optimistic locking with version checks.',
        affected: 'Payment State Management'
      });
      counter++;
    }

    if (!lightningConfig?.correlationId && !lightningConfig?.correlationPattern) {
      findings.push({
        id: `PAYMENT-${String(counter).padStart(3, '0')}`,
        severity: 'high',
        category: 'Traceability',
        description: 'Correlation ID pattern not enforced across payment lifecycle. Difficult to trace payment flows across microservices and debug failures.',
        mitigation: 'Enforce correlation ID propagation through all payment services. Include correlation IDs in logs, events, and external API calls.',
        affected: 'Payment Observability'
      });
      counter++;
    }

    findings.push({
      id: `PAYMENT-${String(counter).padStart(3, '0')}`,
      severity: 'medium',
      category: 'Input Validation',
      description: 'Amount validation required: Maximum theoretical value is 2.1 quadrillion sats (21M BTC * 100M sats). Integer overflow possible if using 32-bit or 64-bit integers without bounds checking.',
      mitigation: 'Use 128-bit integers or BigInt for satoshi calculations. Validate amount bounds (0 < amount <= 2100000000000000). Check for overflow in arithmetic operations.',
      affected: 'Amount Calculation Logic'
    });
    counter++;

    findings.push({
      id: `PAYMENT-${String(counter).padStart(3, '0')}`,
      severity: 'medium',
      category: 'Business Logic',
      description: 'Expired invoice acceptance risk: System may process payments against expired invoices if expiresAt timestamp is not strictly validated.',
      mitigation: 'Strictly validate expiresAt timestamp before accepting payments. Reject payments to expired invoices. Implement automatic invoice expiry cleanup.',
      affected: 'Invoice Lifecycle Management'
    });
    counter++;

    return findings;
  }

  scanMeshSecurity(peerConfig: any): ThreatFinding[] {
    const findings: ThreatFinding[] = [];
    let counter = 1;

    const bootstrapPeers = peerConfig?.bootstrapPeers || [];
    if (bootstrapPeers.length < 3 || peerConfig?.trustUnverified) {
      findings.push({
        id: `MESH-${String(counter).padStart(3, '0')}`,
        severity: 'critical',
        category: 'Sybil Attack',
        description: `Insufficient bootstrap peer diversity (${bootstrapPeers.length} peers) or unverified peer trust enabled. Network vulnerable to Sybil attacks where adversary controls multiple identities.`,
        mitigation: 'Maintain minimum 3+ bootstrap peers from different administrative domains. Implement peer identity verification using cryptographic attestations. Use proof-of-work or proof-of-stake for identity cost.',
        affected: 'Peer Discovery & Bootstrap'
      });
      counter++;
    }

    if (!peerConfig?.minPeerDiversity && !peerConfig?.diversityRequirement) {
      findings.push({
        id: `MESH-${String(counter).padStart(3, '0')}`,
        severity: 'high',
        category: 'Eclipse Attack',
        description: 'No minimum peer diversity requirement configured. Adversary could monopolize all peer connections, isolating node from honest network (Eclipse attack).',
        mitigation: 'Enforce connections to peers from diverse IP ranges and ASNs. Implement feeler connections to probe for alternative routes. Limit connections per IP/ASN.',
        affected: 'Peer Selection Algorithm'
      });
      counter++;
    }

    if (!peerConfig?.pinnedBootstraps && !peerConfig?.verifiedBootstraps) {
      findings.push({
        id: `MESH-${String(counter).padStart(3, '0')}`,
        severity: 'high',
        category: 'Bootstrap Poisoning',
        description: 'Bootstrap peers are not cryptographically pinned or verified. DNS or routing attacks could redirect to malicious bootstrap nodes.',
        mitigation: 'Pin bootstrap peer public keys in configuration. Verify cryptographic signatures during handshake. Use hardcoded IP addresses as fallback.',
        affected: 'Bootstrap Security'
      });
      counter++;
    }

    if (!peerConfig?.stakeRequirement && !peerConfig?.reputationSystem) {
      findings.push({
        id: `MESH-${String(counter).padStart(3, '0')}`,
        severity: 'medium',
        category: 'Reputation System',
        description: 'No stake requirement or reputation system for peer participation. Low cost for attackers to join network and perform misbehavior.',
        mitigation: 'Implement minimum stake requirement for routing nodes. Build reputation scores based on historical behavior. Evict peers with low reputation.',
        affected: 'Peer Admission Control'
      });
      counter++;
    }

    findings.push({
      id: `MESH-${String(counter).padStart(3, '0')}`,
      severity: 'medium',
      category: 'Denial of Service',
      description: 'P2P message flooding vulnerability: Without rate limiting, malicious peers can flood network with invalid messages causing resource exhaustion.',
      mitigation: 'Implement per-peer rate limiting on incoming messages. Use token bucket algorithm for bandwidth allocation. Ban peers exceeding thresholds.',
      affected: 'Message Handling Layer'
    });
    counter++;

    return findings;
  }

  generateReport(findings: ThreatFinding[]): string {
    const counts = {
      critical: findings.filter(f => f.severity === 'critical').length,
      high: findings.filter(f => f.severity === 'high').length,
      medium: findings.filter(f => f.severity === 'medium').length,
      low: findings.filter(f => f.severity === 'low').length
    };

    const summaryTable = `| Severity | Count |
|----------|-------|
| Critical | ${counts.critical} |
| High | ${counts.high} |
| Medium | ${counts.medium} |
| Low | ${counts.low} |
| **Total** | **${findings.length}** |`;

    const findingsSection = findings.map(finding => {
      return `### ${finding.id}: ${finding.severity.toUpperCase()} — ${finding.category}

**Description:** ${finding.description}

**Affected:** ${finding.affected}

**Mitigation:** ${finding.mitigation}`;
    }).join('\n\n');

    const riskMatrix = `| Severity | Likelihood | Impact |
|----------|------------|--------|
| Critical | High | Severe |
| High | Medium-High | High |
| Medium | Medium | Moderate |
| Low | Low | Minor |`;

    const conclusion = `This threat model identifies ${findings.length} potential security concerns across the distributed mesh architecture. Immediate attention is required for ${counts.critical} critical and ${counts.high} high severity findings, particularly around payment integrity and mesh peer security. Implementing the recommended mitigations will significantly reduce the attack surface and improve the resilience of the Bucky network against both Byzantine faults and malicious adversaries. Regular reassessment is recommended as the protocol evolves.`;

    return `# Bucky Distributed Mesh — Threat Model Report

## Summary

${summaryTable}

## Findings

${findingsSection}

## Risk Matrix

${riskMatrix}

## Conclusion

${conclusion}`;
  }
}

export { ThreatModelScanner };
export default ThreatModelScanner;
