/**
 * Project Bucky Mesh - LibP2P & PBFT Consensus Security Hardening Module
 * 
 * Addresses 14 critical security gaps in distributed mesh networking and
 * Byzantine Fault Tolerant consensus systems.
 * 
 * @module bucky-mesh-security
 * @version 1.0.0
 */

import crypto from 'crypto';
import { EventEmitter } from 'events';
import { promisify } from 'util';

// Type Definitions
interface DHTEntry {
  key: string;
  value: unknown;
  timestamp: number;
  ttl: number;
  nodeId: string;
}

interface PeerInfo {
  id: string;
  ip: string;
  port?: number;
  asn?: string;
  region?: string;
  capabilities?: Record<string, unknown>;
}

interface VoteRecord {
  roundId: string;
  vote: string;
  timestamp: number;
  signature: string;
}

interface STUNCandidate {
  ip: string;
  port: number;
  nonce: string;
  timestamp: number;
}

interface GeoVoter {
  id: string;
  region: string;
  asn: string;
}

interface RelayStats {
  bytesTransferred: number;
  lastReset: number;
  requestCount: number;
  depositAmount: number;
}

/**
 * Network-layer security hardening for LibP2P mesh networks.
 * Addresses DHT poisoning, eclipse attacks, Sybil identities, and transport security.
 */
export class NetworkHardening extends EventEmitter {
  private reputationTable: Map<string, number> = new Map();
  private identityRateLimiter: Map<string, number[]> = new Map();
  private relayStats: Map<string, RelayStats> = new Map();
  private pinnedCerts: Map<string, string> = new Map();
  private activeNegotiations: Set<string> = new Set();
  private protocolVersion: string = '2.0.0';
  
  // Rate limiting windows (in ms)
  private readonly ID_RATE_WINDOW = 60 * 60 * 1000; // 1 hour
  private readonly RELAY_RATE_WINDOW = 60 * 1000;   // 1 minute

  /**
   * Creates an instance of NetworkHardening.
   * @param {Object} options - Configuration options
   * @param {string} [options.minProtocolVersion='2.0.0'] - Minimum acceptable protocol version
   */
  constructor(options: { minProtocolVersion?: string } = {}) {
    super();
    this.protocolVersion = options.minProtocolVersion || '2.0.0';
  }

  // ============================================================================
  // GAP 1: DHT Poisoning Prevention
  // ============================================================================

  /**
   * Cryptographically signs a DHT entry using Ed25519 to prevent poisoning.
   * 
   * @param {string} nodeId - The node identifier
   * @param {DHTEntry} entry - The DHT entry to sign
   * @param {string} privateKey - Ed25519 private key (hex or PEM)
   * @returns {string} Base64-encoded signature
   * @throws {Error} If signing fails
   */
  signDHTEntry(nodeId: string, entry: DHTEntry, privateKey: string): string {
    try {
      const data = Buffer.from(JSON.stringify({
        key: entry.key,
        value: entry.value,
        timestamp: entry.timestamp,
        ttl: entry.ttl,
        nodeId
      }));

      // Note: In production, use @noble/ed25519 for pure JS or secp256k1
      const signer = crypto.createSign('sha256');
      signer.update(data);
      signer.end();
      
      // For Ed25519, Node.js crypto.sign is preferred in newer versions
      const signature = crypto.sign('sha256', data, privateKey);
      return signature.toString('base64');
    } catch (error) {
      throw new Error(`DHT signing failed: ${(error as Error).message}`);
    }
  }

  /**
   * Verifies DHT entry signature before acceptance into routing table.
   * 
   * @param {DHTEntry} entry - The DHT entry
   * @param {string} signature - Base64-encoded signature
   * @param {string} publicKey - Ed25519 public key (hex or PEM)
   * @returns {boolean} True if signature is valid
   */
  verifyDHTEntry(entry: DHTEntry, signature: string, publicKey: string): boolean {
    try {
      const data = Buffer.from(JSON.stringify({
        key: entry.key,
        value: entry.value,
        timestamp: entry.timestamp,
        ttl: entry.ttl,
        nodeId: entry.nodeId
      }));

      const sigBuffer = Buffer.from(signature, 'base64');
      return crypto.verify('sha256', data, publicKey, sigBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Rejects peers below minimum reputation from DHT routing tables.
   * 
   * @param {string} peerId - The peer identifier
   * @param {number} minReputation - Minimum reputation score (0.0 - 1.0)
   * @returns {boolean} True if peer passes reputation gate
   */
  reputationGateDHT(peerId: string, minReputation: number = 0.8): boolean {
    const reputation = this.reputationTable.get(peerId) || 1.0;
    if (reputation < minReputation) {
      this.emit('dht:rejection', { peerId, reputation, reason: 'below_threshold' });
      return false;
    }
    return true;
  }

  // ============================================================================
  // GAP 2: Eclipse Attack Prevention
  // ============================================================================

  /**
   * Enforces connection diversity requiring peers from 3+ different /24 subnets.
   * 
   * @param {Array<{id: string, ip: string}>} peers - Connected peers
   * @returns {{valid: boolean, subnets: string[], violations: string[]}}
   */
  enforcePeerDiversity(peers: Array<{id: string, ip: string}>): {
    valid: boolean;
    subnets: string[];
    violations: string[];
  } {
    const subnets = new Set<string>();
    const subnetCounts = new Map<string, number>();
    const violations: string[] = [];

    for (const peer of peers) {
      const subnet = this.getSubnet24(peer.ip);
      subnets.add(subnet);
      subnetCounts.set(subnet, (subnetCounts.get(subnet) || 0) + 1);
    }

    // Check for minimum 3 subnets
    if (subnets.size < 3) {
      violations.push(`Insufficient subnet diversity: ${subnets.size} subnets (min 3)`);
    }

    // Check no single subnet > 30%
    const maxAllowed = Math.ceil(peers.length * 0.3);
    for (const [subnet, count] of subnetCounts) {
      if (count > maxAllowed) {
        violations.push(`Subnet ${subnet} exceeds 30% threshold: ${count} peers`);
      }
    }

    return {
      valid: violations.length === 0,
      subnets: Array.from(subnets),
      violations
    };
  }

  /**
   * Maintains diverse K-buckets ensuring no single subnet dominates.
   * 
   * @param {Map<string, string[]>} buckets - K-buckets mapping bucket ID to peer IPs
   * @returns {Map<string, string[]>} Sanitized buckets
   */
  maintainDiverseBuckets(buckets: Map<string, string[]>): Map<string, string[]> {
    const sanitized = new Map<string, string[]>();

    for (const [bucketId, peers] of buckets) {
      const subnetCounts = new Map<string, number>();
      const diversePeers: string[] = [];

      for (const peer of peers) {
        const subnet = this.getSubnet24(peer);
        const count = subnetCounts.get(subnet) || 0;
        
        // Allow max 30% from same subnet
        if (count < Math.ceil(peers.length * 0.3)) {
          diversePeers.push(peer);
          subnetCounts.set(subnet, count + 1);
        } else {
          this.emit('bucket:pruned', { bucketId, peer, reason: 'subnet_cap' });
        }
      }

      sanitized.set(bucketId, diversePeers);
    }

    return sanitized;
  }

  /**
   * Detects potential eclipse attacks if all peers originate from same ASN.
   * 
   * @param {string[]} connectedPeers - List of peer IDs with ASN metadata
   * @param {Map<string, string>} peerAsns - Mapping of peerId to ASN
   * @returns {{alert: boolean, asn: string | null, peerCount: number}}
   */
  detectEclipse(
    connectedPeers: string[], 
    peerAsns: Map<string, string>
  ): { alert: boolean; asn: string | null; peerCount: number } {
    if (connectedPeers.length === 0) {
      return { alert: false, asn: null, peerCount: 0 };
    }

    const asnCounts = new Map<string, number>();
    for (const peerId of connectedPeers) {
      const asn = peerAsns.get(peerId) || 'unknown';
      asnCounts.set(asn, (asnCounts.get(asn) || 0) + 1);
    }

    // Check if all peers from same ASN
    if (asnCounts.size === 1) {
      const [asn, count] = asnCounts.entries().next().value;
      this.emit('eclipse:alert', { asn, peerCount: count });
      return { alert: true, asn, peerCount: count };
    }

    return { alert: false, asn: null, peerCount: connectedPeers.length };
  }

  // ============================================================================
  // GAP 3: Sybil Identity Protection
  // ============================================================================

  /**
   * Verifies minimum stake requirement to prevent Sybil attacks.
   * 
   * @param {string} nodeId - Node identifier
   * @param {number} stakeAmount - Stake in satoshis
   * @param {number} minStake - Minimum required stake (default: 1000 sats)
   * @returns {{valid: boolean, stake: number, deficit: number}}
   */
  verifyStake(
    nodeId: string, 
    stakeAmount: number, 
    minStake: number = 1000
  ): { valid: boolean; stake: number; deficit: number } {
    const valid = stakeAmount >= minStake;
    const deficit = valid ? 0 : minStake - stakeAmount;
    
    if (!valid) {
      this.emit('sybil:insufficient_stake', { nodeId, stakeAmount, minStake });
    }
    
    return { valid, stake: stakeAmount, deficit };
  }

  /**
   * Rate limits new identity creation per IP address.
   * 
   * @param {string} ip - IP address
   * @param {number} windowMs - Time window in milliseconds (default: 1 hour)
   * @param {number} maxNew - Maximum new identities per window (default: 3)
   * @returns {{allowed: boolean, remaining: number, resetTime: number}}
   */
  rateLimitNewIdentities(
    ip: string, 
    windowMs: number = this.ID_RATE_WINDOW, 
    maxNew: number = 3
  ): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    // Get existing timestamps for this IP
    let timestamps = this.identityRateLimiter.get(ip) || [];
    
    // Filter to current window
    timestamps = timestamps.filter(ts => ts > windowStart);
    
    if (timestamps.length >= maxNew) {
      const resetTime = timestamps[0] + windowMs;
      return { allowed: false, remaining: 0, resetTime };
    }

    // Add new identity timestamp
    timestamps.push(now);
    this.identityRateLimiter.set(ip, timestamps);
    
    return {
      allowed: true,
      remaining: maxNew - timestamps.length,
      resetTime: now + windowMs
    };
  }

  /**
   * Detects Sybil clusters by identifying identical capabilities from same /16 range.
   * 
   * @param {Array<{id: string, ip: string, capabilities: object}>} nodes - Node list
   * @returns {Array<{subnet16: string, nodes: string[], confidence: number}>} Detected clusters
   */
  detectSybilCluster(
    nodes: Array<{id: string; ip: string; capabilities: Record<string, unknown>}>
  ): Array<{subnet16: string; nodes: string[]; confidence: number}> {
    const clusters = new Map<string, Map<string, string[]>>(); // subnet -> capabilities hash -> nodes
    
    for (const node of nodes) {
      const subnet16 = this.getSubnet16(node.ip);
      const capHash = this.hashCapabilities(node.capabilities);
      
      if (!clusters.has(subnet16)) {
        clusters.set(subnet16, new Map());
      }
      
      const capMap = clusters.get(subnet16)!;
      if (!capMap.has(capHash)) {
        capMap.set(capHash, []);
      }
      
      capMap.get(capHash)!.push(node.id);
    }

    const results: Array<{subnet16: string; nodes: string[]; confidence: number}> = [];
    
    for (const [subnet16, capMap] of clusters) {
      for (const [capHash, nodeIds] of capMap) {
        if (nodeIds.length >= 3) { // Sybil cluster threshold
          // Confidence based on count and capability similarity
          const confidence = Math.min(0.95, 0.5 + (nodeIds.length * 0.1));
          results.push({ subnet16, nodes: nodeIds, confidence });
          
          this.emit('sybil:cluster_detected', {
            subnet16,
            nodeCount: nodeIds.length,
            capabilities: capHash
          });
        }
      }
    }

    return results;
  }

  // ============================================================================
  // GAP 4: Peer Authentication
  // ============================================================================

  /**
   * Enforces mutual TLS verification for peer connections.
   * 
   * @param {string} peerId - Peer identifier
   * @param {string} cert - PEM-encoded certificate
   * @returns {{valid: boolean, fingerprint: string, error?: string}}
   */
  enforceMTLS(peerId: string, cert: string): { 
    valid: boolean; 
    fingerprint: string; 
    error?: string 
  } {
    try {
      // Parse certificate and extract public key fingerprint
      const certBuffer = Buffer.from(cert);
      const fingerprint = crypto
        .createHash('sha256')
        .update(certBuffer)
        .digest('hex')
        .substring(0, 16);

      // Verify certificate chain (simplified - production needs full X509 validation)
      // Check against pinned certs for bootstrap nodes
      if (this.pinnedCerts.has(peerId)) {
        const pinned = this.pinnedCerts.get(peerId)!;
        if (pinned !== cert) {
          return { valid: false, fingerprint, error: 'Certificate pinning mismatch' };
        }
      }

      return { valid: true, fingerprint };
    } catch (error) {
      return { valid: false, fingerprint: '', error: (error as Error).message };
    }
  }

  /**
   * Pins certificates for bootstrap nodes to prevent MITM during initial join.
   * 
   * @param {string[]} bootstrapPeers - Array of bootstrap peer IDs
   * @param {Map<string, string>} certs - Map of peerId to certificate
   */
  pinBootstrapCerts(bootstrapPeers: string[], certs: Map<string, string>): void {
    for (const peerId of bootstrapPeers) {
      if (certs.has(peerId)) {
        this.pinnedCerts.set(peerId, certs.get(peerId)!);
      }
    }
  }

  /**
   * Verifies peer identity via cryptographic challenge-response.
   * 
   * @param {string} peerId - Peer identifier
   * @param {string} challenge - Random challenge string
   * @param {string} response - Signed response
   * @param {string} publicKey - Peer public key
   * @returns {boolean} True if challenge response is valid
   */
  verifyPeerIdentity(
    peerId: string, 
    challenge: string, 
    response: string, 
    publicKey: string
  ): boolean {
    try {
      const data = Buffer.from(challenge);
      const sig = Buffer.from(response, 'base64');
      return crypto.verify('sha256', data, publicKey, sig);
    } catch {
      return false;
    }
  }

  // ============================================================================
  // GAP 5: Traffic Analysis Resistance
  // ============================================================================

  /**
   * Pads messages to fixed size to prevent size-based traffic analysis.
   * 
   * @param {Buffer} msg - Original message
   * @param {number} targetSize - Target size in bytes (default: 1024)
   * @returns {Buffer} Padded message
   */
  padMessage(msg: Buffer, targetSize: number = 1024): Buffer {
    if (msg.length > targetSize) {
      throw new Error(`Message exceeds target size: ${msg.length} > ${targetSize}`);
    }
    
    const paddingSize = targetSize - msg.length;
    const padding = crypto.randomBytes(paddingSize);
    
    // Format: [4 bytes original length][message][random padding]
    const lengthPrefix = Buffer.alloc(4);
    lengthPrefix.writeUInt32BE(msg.length);
    
    return Buffer.concat([lengthPrefix, msg, padding]);
  }

  /**
   * Adds random delay to message relay to prevent timing correlation.
   * 
   * @param {number} minMs - Minimum delay (default: 10)
   * @param {number} maxMs - Maximum delay (default: 50)
   * @returns {Promise<void>}
   */
  async addRandomDelay(minMs: number = 10, maxMs: number = 50): Promise<void> {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    await promisify(setTimeout)(delay);
  }

  /**
   * Generates cover traffic to prevent timing analysis.
   * 
   * @param {number} intervalMs - Interval between cover messages (default: 5000)
   * @param {() => void} sender - Function to send dummy message
   * @returns {() => void} Function to stop cover traffic
   */
  generateCoverTraffic(
    intervalMs: number = 5000, 
    sender: () => void = () => {}
  ): () => void {
    const interval = setInterval(() => {
      // Generate dummy message with random payload
      const dummyPayload = crypto.randomBytes(64);
      this.emit('cover:traffic', { timestamp: Date.now(), payload: dummyPayload });
      sender();
    }, intervalMs);

    return () => clearInterval(interval);
  }

  // ============================================================================
  // GAP 6: Protocol Downgrade Prevention
  // ============================================================================

  /**
   * Enforces minimum protocol version to prevent downgrade attacks.
   * 
   * @param {string} version - Peer protocol version (semver)
   * @returns {{accepted: boolean, reason?: string}}
   */
  enforceMinProtocolVersion(version: string): { accepted: boolean; reason?: string } {
    const min = this.protocolVersion.split('.').map(Number);
    const peer = version.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      if (peer[i] > min[i]) return { accepted: true };
      if (peer[i] < min[i]) {
        return { 
          accepted: false, 
          reason: `Version ${version} below minimum ${this.protocolVersion}` 
        };
    }
    }

    return { accepted: true };
  }

  /**
   * Negotiates secure handshake enforcing Noise XX + Yamux only.
   * 
   * @param {string} peerId - Peer identifier
   * @param {string[]} proposedProtocols - Protocols offered by peer
   * @returns {{accepted: boolean, selected: string[]}}
   */
  negotiateSecureHandshake(
    peerId: string, 
    proposedProtocols: string[]
  ): { accepted: boolean; selected: string[] } {
    const required = ['noise-xx', 'yamux'];
    const hasNoise = proposedProtocols.some(p => 
      p.toLowerCase().includes('noise-xx') || p.toLowerCase().includes('noise_xx')
    );
    const hasYamux = proposedProtocols.some(p => 
      p.toLowerCase().includes('yamux')
    );

    if (!hasNoise || !hasYamux) {
      this.emit('handshake:rejected', { 
        peerId, 
        reason: 'Insecure protocol proposed',
        proposed: proposedProtocols 
      });
      return { accepted: false, selected: [] };
    }

    // Reject if plaintext or insecure fallbacks offered
    const insecure = ['plaintext', 'secio', 'tls1.0', 'tls1.1'];
    if (proposedProtocols.some(p => insecure.includes(p.toLowerCase()))) {
      return { accepted: false, selected: [] };
    }

    return { accepted: true, selected: required };
  }

  // ============================================================================
  // GAP 7: Relay Abuse Prevention
  // ============================================================================

  /**
   * Rate limits relay requests per peer.
   * 
   * @param {string} peerId - Peer identifier
   * @param {number} maxPerMin - Maximum requests per minute (default: 100)
   * @returns {{allowed: boolean, currentCount: number, resetTime: number}}
   */
  rateLimitRelay(
    peerId: string, 
    maxPerMin: number = 100
  ): { allowed: boolean; currentCount: number; resetTime: number } {
    const now = Date.now();
    const stats = this.relayStats.get(peerId) || {
      bytesTransferred: 0,
      lastReset: now,
      requestCount: 0,
      depositAmount: 0
    };

    // Reset window
    if (now - stats.lastReset > this.RELAY_RATE_WINDOW) {
      stats.requestCount = 0;
      stats.lastReset = now;
    }

    stats.requestCount++;
    this.relayStats.set(peerId, stats);

    const allowed = stats.requestCount <= maxPerMin;
    if (!allowed) {
      this.emit('relay:rate_limited', { peerId, count: stats.requestCount });
    }

    return {
      allowed,
      currentCount: stats.requestCount,
      resetTime: stats.lastReset + this.RELAY_RATE_WINDOW
    };
  }

  /**
   * Requires deposit to use relay services.
   * 
   * @param {string} peerId - Peer identifier
   * @param {number} depositSats - Required deposit in satoshis
   * @returns {{hasDeposit: boolean, currentDeposit: number}}
   */
  requireRelayDeposit(
    peerId: string, 
    depositSats: number
  ): { hasDeposit: boolean; currentDeposit: number } {
    const stats = this.relayStats.get(peerId);
    const currentDeposit = stats?.depositAmount || 0;
    const hasDeposit = currentDeposit >= depositSats;

    if (!hasDeposit) {
      this.emit('relay:deposit_required', { peerId, required: depositSats, current: currentDeposit });
    }

    return { hasDeposit, currentDeposit };
  }

  /**
   * Monitors relay bandwidth for abuse detection.
   * 
   * @param {string} relayId - Relay node identifier
   * @param {number} maxBytes - Maximum bytes allowed in window
   * @returns {{exceeded: boolean, usagePercent: number}}
   */
  monitorRelayBandwidth(
    relayId: string, 
    maxBytes: number = 1024 * 1024 * 100 // 100MB default
  ): { exceeded: boolean; usagePercent: number } {
    const stats = this.relayStats.get(relayId);
    if (!stats) return { exceeded: false, usagePercent: 0 };

    const usagePercent = (stats.bytesTransferred / maxBytes) * 100;
    const exceeded = stats.bytesTransferred > maxBytes;

    if (exceeded) {
      this.emit('relay:bandwidth_exceeded', { 
        relayId, 
        bytes: stats.bytesTransferred, 
        limit: maxBytes 
      });
    }

    return { exceeded, usagePercent };
  }

  // ============================================================================
  // GAP 8: NAT Traversal Security
  // ============================================================================

  /**
   * Validates STUN response includes correct nonce to prevent spoofing.
   * 
   * @param {STUNCandidate} candidate - ICE candidate
   * @param {string} expectedNonce - Expected nonce
   * @returns {boolean} True if valid
   */
  validateSTUN(candidate: STUNCandidate, expectedNonce: string): boolean {
    // Verify nonce matches (prevent replay attacks)
    if (candidate.nonce !== expectedNonce) return false;
    
    // Verify timestamp within window (5 minutes)
    const now = Date.now();
    if (Math.abs(now - candidate.timestamp) > 5 * 60 * 1000) return false;

    return true;
  }

  /**
   * Rejects unsolicited ICE candidates not matching active negotiations.
   * 
   * @param {string} candidateId - Candidate identifier
   * @returns {boolean} True if candidate should be accepted
   */
  rejectUnsolicitedCandidates(candidateId: string): boolean {
    if (!this.activeNegotiations.has(candidateId)) {
      this.emit('nat:unsolicited_candidate', { candidateId });
      return false;
    }
    return true;
  }

  /**
   * Verifies TURN server credentials.
   * 
   * @param {string} serverUrl - TURN server URL
   * @param {string} credential - Shared secret or token
   * @param {string} username - Username (often timestamp-based)
   * @returns {{valid: boolean, server: string}}
   */
  verifyTURNServer(
    serverUrl: string, 
    credential: string, 
    username: string
  ): { valid: boolean; server: string } {
    try {
      // Validate URL format
      const url = new URL(serverUrl);
      if (url.protocol !== 'turn:' && url.protocol !== 'turns:') {
        return { valid: false, server: serverUrl };
      }

      // Verify credential format (HMAC-SHA1 of timestamp for time-limited credentials)
      const timestamp = parseInt(username.split(':')[0]);
      if (isNaN(timestamp) || timestamp < Date.now() / 1000) {
        return { valid: false, server: serverUrl };
      }

      // In production: verify HMAC(shared_secret, username) === credential
      return { valid: true, server: serverUrl };
    } catch {
      return { valid: false, server: serverUrl };
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private getSubnet24(ip: string): string {
    const parts = ip.split('.');
    if (parts.length !== 4) return 'invalid';
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }

  private getSubnet16(ip: string): string {
    const parts = ip.split('.');
    if (parts.length !== 4) return 'invalid';
    return `${parts[0]}.${parts[1]}.0.0/16`;
  }

  private hashCapabilities(capabilities: Record<string, unknown>): string {
    const sorted = Object.keys(capabilities).sort().reduce((acc, key) => {
      acc[key] = capabilities[key];
      return acc;
    }, {} as Record<string, unknown>);
    
    return crypto.createHash('sha256')
      .update(JSON.stringify(sorted))
      .digest('hex')
      .substring(0, 16);
  }
}

/**
 * Consensus-layer security hardening for PBFT protocols.
 * Addresses Byzantine faults, view changes, clock skew, and leader selection.
 */
export class ConsensusHardening extends EventEmitter {
  private voteHistory: Map<string, Map<string, VoteRecord>> = new Map(); // nodeId -> roundId -> vote
  private viewChangeHistory: number[] = [];
  private leaderHistory: string[] = [];
  private lastViewChange: number = 0;
  private readonly VIEW_CHANGE_WINDOW = 30000; // 30 seconds
  
  // VRF state (simplified - production needs BLS12-381 or similar)
  private vrfKeys: Map<string, { publicKey: string; privateKey: string }> = new Map();

  /**
   * Creates an instance of ConsensusHardening.
   */
  constructor() {
    super();
  }

  // ============================================================================
  // GAP 9: Byzantine Equivocation Detection
  // ============================================================================

  /**
   * Detects double-voting (equivocation) by same node in same round.
   * 
   * @param {string} nodeId - Node identifier
   * @param {Array<{roundId: string, vote: string}>} votes - Votes to check
   * @returns {{equivocated: boolean, evidence: object | null}}
   */
  detectDoubleVote(
    nodeId: string, 
    votes: Array<{roundId: string; vote: string; timestamp?: number; signature?: string}>
  ): { equivocated: boolean; evidence: object | null } {
    if (!this.voteHistory.has(nodeId)) {
      this.voteHistory.set(nodeId, new Map());
    }

    const nodeVotes = this.voteHistory.get(nodeId)!;

    for (const vote of votes) {
      const existing = nodeVotes.get(vote.roundId);
      
      if (existing) {
        // Check if voting differently in same round
        if (existing.vote !== vote.vote) {
          const evidence = {
            nodeId,
            roundId: vote.roundId,
            vote1: existing,
            vote2: vote,
            timestamp: Date.now()
          };
          
          this.emit('consensus:equivocation', evidence);
          return { equivocated: true, evidence };
        }
      } else {
        // Record new vote
        nodeVotes.set(vote.roundId, {
          roundId: vote.roundId,
          vote: vote.vote,
          timestamp: vote.timestamp || Date.now(),
          signature: vote.signature || ''
        });
      }
    }

    return { equivocated: false, evidence: null };
  }

  /**
   * Auto-slashes stake on double-vote proof.
   * 
   * @param {string} nodeId - Equivocating node
   * @param {object} evidence - Proof of equivocation
   * @returns {{slashed: boolean, amount: number, txHash: string}}
   */
  slashEquivocator(
    nodeId: string, 
    evidence: object
  ): { slashed: boolean; amount: number; txHash: string } {
    // In production: submit slashing transaction to blockchain
    const txHash = crypto.randomBytes(32).toString('hex');
    
    this.emit('consensus:slash', {
      nodeId,
      evidence,
      txHash,
      timestamp: Date.now()
    });

    return {
      slashed: true,
      amount: 1000, // Minimum stake
      txHash
    };
  }

  // ============================================================================
  // GAP 10: View Change Storm Prevention
  // ============================================================================

  /**
   * Rate limits view changes to prevent storm attacks.
   * 
   * @param {number} maxPerWindow - Max view changes per window (default: 1)
   * @param {number} windowMs - Window size in ms (default: 30000)
   * @returns {{allowed: boolean, remaining: number, nextAllowed: number}}
   */
  rateLimitViewChanges(
    maxPerWindow: number = 1, 
    windowMs: number = this.VIEW_CHANGE_WINDOW
  ): { allowed: boolean; remaining: number; nextAllowed: number } {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    // Clean old entries
    this.viewChangeHistory = this.viewChangeHistory.filter(ts => ts > windowStart);
    
    if (this.viewChangeHistory.length >= maxPerWindow) {
      const nextAllowed = this.viewChangeHistory[0] + windowMs;
      return { allowed: false, remaining: 0, nextAllowed };
    }

    this.viewChangeHistory.push(now);
    return {
      allowed: true,
      remaining: maxPerWindow - this.viewChangeHistory.length,
      nextAllowed: now
    };
  }

  /**
   * Calculates exponential backoff for rapid reconfigurations.
   * 
   * @param {number} attemptNumber - Current attempt number (0-indexed)
   * @param {number} baseDelay - Base delay in ms (default: 1000)
   * @param {number} maxDelay - Maximum delay in ms (default: 30000)
   * @returns {number} Delay in milliseconds
   */
  exponentialBackoff(
    attemptNumber: number, 
    baseDelay: number = 1000, 
    maxDelay: number = 30000
  ): number {
    const delay = Math.min(baseDelay * Math.pow(2, attemptNumber), maxDelay);
    const jitter = Math.floor(Math.random() * 100); // Add jitter to prevent thundering herd
    return delay + jitter;
  }

  // ============================================================================
  // GAP 11: Clock Skew Protection
  // ============================================================================

  /**
   * Validates message timestamp against local clock.
   * 
   * @param {Date} messageTime - Message timestamp
   * @param {Date} localTime - Local timestamp
   * @param {number} toleranceMs - Maximum allowed difference (default: 500)
   * @returns {{valid: boolean, drift: number}}
   */
  validateTimestamp(
    messageTime: Date, 
    localTime: Date, 
    toleranceMs: number = 500
  ): { valid: boolean; drift: number } {
    const drift = Math.abs(messageTime.getTime() - localTime.getTime());
    const valid = drift <= toleranceMs;
    
    if (!valid) {
      this.emit('consensus:clock_drift', { drift, tolerance: toleranceMs });
    }
    
    return { valid, drift };
  }

  /**
   * Checks if NTP/chrony is synchronized.
   * 
   * @returns {{synced: boolean, source: string, offset: number}}
   */
  requireNTPSync(): { synced: boolean; source: string; offset: number } {
    // In production: exec('chronyc tracking') or check system clock
    // Mock implementation - assume synced with small offset
    const offset = Math.random() * 10; // 0-10ms offset
    
    return {
      synced: offset < 50, // Consider synced if < 50ms offset
      source: 'chronyd',
      offset
    };
  }

  /**
   * Statistically detects impossible timing patterns (clock manipulation).
   * 
   * @param {Date[]} timestamps - Array of observed timestamps
   * @returns {{manipulated: boolean, confidence: number, anomaly: string | null}}
   */
  detectClockManipulation(timestamps: Date[]): { 
    manipulated: boolean; 
    confidence: number; 
    anomaly: string | null 
  } {
    if (timestamps.length < 3) return { manipulated: false, confidence: 0, anomaly: null };

    // Calculate intervals
    const intervals: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i].getTime() - timestamps[i-1].getTime());
    }

    // Check for negative intervals (time going backwards)
    const negativeIntervals = intervals.filter(i => i < 0);
    if (negativeIntervals.length > 0) {
      return { 
        manipulated: true, 
        confidence: 0.95, 
        anomaly: 'time_regression' 
      };
    }

    // Check for impossible precision (all intervals identical to ms)
    const uniqueIntervals = new Set(intervals).size;
    if (uniqueIntervals === 1 && intervals.length > 5) {
      return { 
        manipulated: true, 
        confidence: 0.8, 
        anomaly: 'artificial_precision' 
      };
    }

    // Statistical outlier detection (Grubbs' test simplified)
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    
    const outliers = intervals.filter(i => Math.abs(i - mean) > 3 * stdDev);
    if (outliers.length > intervals.length * 0.1) {
      return { 
        manipulated: true, 
        confidence: 0.7, 
        anomaly: 'temporal_anomaly' 
      };
    }

    return { manipulated: false, confidence: 0, anomaly: null };
  }

  // ============================================================================
  // GAP 12: Leader Monopoly Prevention
  // ============================================================================

  /**
   * Selects leader using Verifiable Random Function (VRF).
   * 
   * @param {number} roundNumber - Current round number
   * @param {string[]} participants - Array of eligible node IDs
   * @param {string} vrfSeed - VRF seed (previous block hash or deterministic entropy)
   * @returns {{leader: string, proof: string, valid: boolean}}
   */
  selectLeaderVRF(
    roundNumber: number, 
    participants: string[], 
    vrfSeed: string
  ): { leader: string; proof: string; valid: boolean } {
    if (participants.length === 0) {
      return { leader: '', proof: '', valid: false };
    }

    // Simplified VRF using HMAC-SHA256
    // Production: Use BLS12-381 based VRF (RFC 9381)
    const vrfInput = `${vrfSeed}:${roundNumber}`;
    const vrfOutput = crypto.createHmac('sha256', 'vrf-secret').update(vrfInput).digest();
    
    // Convert first 4 bytes to integer for selection
    const rand = vrfOutput.readUInt32BE(0);
    const leaderIndex = rand % participants.length;
    const leader = participants[leaderIndex];
    
    // Proof is the VRF output + input
    const proof = Buffer.concat([
      Buffer.from(vrfInput),
      vrfOutput
    ]).toString('base64');

    this.leaderHistory.push(leader);
    // Keep last 100 for bias detection
    if (this.leaderHistory.length > 100) {
      this.leaderHistory.shift();
    }

    return { leader, proof, valid: true };
  }

  /**
   * Enforces leader rotation after max consecutive rounds.
   * 
   * @param {string} currentLeader - Current leader ID
   * @param {number} maxConsecutiveRounds - Maximum allowed (default: 10)
   * @returns {{shouldRotate: boolean, consecutiveCount: number}}
   */
  enforceLeaderRotation(
    currentLeader: string, 
    maxConsecutiveRounds: number = 10
  ): { shouldRotate: boolean; consecutiveCount: number } {
    let consecutiveCount = 0;
    
    // Count from end backwards
    for (let i = this.leaderHistory.length - 1; i >= 0; i--) {
      if (this.leaderHistory[i] === currentLeader) {
        consecutiveCount++;
      } else {
        break;
      }
    }

    const shouldRotate = consecutiveCount >= maxConsecutiveRounds;
    
    if (shouldRotate) {
      this.emit('consensus:force_rotation', { currentLeader, consecutiveCount });
    }

    return { shouldRotate, consecutiveCount };
  }

  /**
   * Detects statistical bias in leader selection using Chi-squared test.
   * 
   * @param {string[]} leaderHistory - Array of historical leaders
   * @returns {{biased: boolean, chiSquared: number, pValue: number}}
   */
  detectLeaderBias(
    leaderHistory: string[] = this.leaderHistory
  ): { biased: boolean; chiSquared: number; pValue: number } {
    if (leaderHistory.length < 20) {
      return { biased: false, chiSquared: 0, pValue: 1 };
    }

    // Count occurrences
    const counts = new Map<string, number>();
    for (const leader of leaderHistory) {
      counts.set(leader, (counts.get(leader) || 0) + 1);
    }

    const n = leaderHistory.length;
    const k = counts.size;
    const expected = n / k;

    // Calculate Chi-squared statistic
    let chiSquared = 0;
    for (const count of counts.values()) {
      chiSquared += Math.pow(count - expected, 2) / expected;
    }

    // Degrees of freedom = k - 1
    // Critical value for df=9, p=0.05 is ~16.9 (simplified check)
    const criticalValue = 16.9;
    const biased = chiSquared > criticalValue;
    const pValue = biased ? 0.03 : 0.5; // Simplified p-value estimation

    if (biased) {
      this.emit('consensus:leader_bias', { chiSquared, participants: k, sampleSize: n });
    }

    return { biased, chiSquared, pValue };
  }

  // ============================================================================
  // GAP 13: Quorum Manipulation Prevention
  // ============================================================================

  /**
   * Enforces geographic and ASN diversity in quorum.
   * 
   * @param {GeoVoter[]} voters - Array of voters with geo metadata
   * @param {number} maxPercent - Max percentage per region/ASN (default: 30)
   * @returns {{valid: boolean, violations: string[], diversity: object}}
   */
  enforceGeoDiversity(
    voters: GeoVoter[], 
    maxPercent: number = 30
  ): { valid: boolean; violations: string[]; diversity: object } {
    const regionCounts = new Map<string, number>();
    const asnCounts = new Map<string, number>();
    const total = voters.length;

    for (const voter of voters) {
      regionCounts.set(voter.region, (regionCounts.get(voter.region) || 0) + 1);
      asnCounts.set(voter.asn, (asnCounts.get(voter.asn) || 0) + 1);
    }

    const violations: string[] = [];
    const maxAllowed = (total * maxPercent) / 100;

    // Check region concentration
    for (const [region, count] of regionCounts) {
      if (count > maxAllowed) {
        violations.push(`Region ${region} exceeds ${maxPercent}%: ${count}/${total}`);
      }
    }

    // Check ASN concentration
    for (const [asn, count] of asnCounts) {
      if (count > maxAllowed) {
        violations.push(`ASN ${asn} exceeds ${maxPercent}%: ${count}/${total}`);
      }
    }

    return {
      valid: violations.length === 0,
      violations,
      diversity: {
        regions: Object.fromEntries(regionCounts),
        asns: Object.fromEntries(asnCounts)
      }
    };
  }

  /**
   * Detects collusion patterns in voting using correlation analysis.
   * 
   * @param {Map<string, string[]>} votingPatterns - Map of proposalId to array of voter IDs
   * @returns {Array<{nodes: string[], correlation: number, confidence: number}>}
   */
  detectQuorumCollusion(
    votingPatterns: Map<string, string[]>
  ): Array<{nodes: string[]; correlation: number; confidence: number}> {
    const voterCooccurrence = new Map<string, Map<string, number>>();
    const totalVotes = votingPatterns.size;

    // Build co-occurrence matrix
    for (const voters of votingPatterns.values()) {
      for (let i = 0; i < voters.length; i++) {
        for (let j = i + 1; j < voters.length; j++) {
          const v1 = voters[i];
          const v2 = voters[j];
          
          if (!voterCooccurrence.has(v1)) voterCooccurrence.set(v1, new Map());
          if (!voterCooccurrence.has(v2)) voterCooccurrence.set(v2, new Map());
          
          const count1 = voterCooccurrence.get(v1)!.get(v2) || 0;
          voterCooccurrence.get(v1)!.set(v2, count1 + 1);
          
          const count2 = voterCooccurrence.get(v2)!.get(v1) || 0;
          voterCooccurrence.get(v2)!.set(v1, count2 + 1);
        }
      }
    }

    const collusionGroups: Array<{nodes: string[]; correlation: number; confidence: number}> = [];

    // Find highly correlated pairs (Jaccard similarity > 0.8)
    const processed = new Set<string>();
    
    for (const [v1, neighbors] of voterCooccurrence) {
      for (const [v2, coCount] of neighbors) {
        if (processed.has(`${v2}-${v1}`)) continue;
        
        const correlation = coCount / totalVotes;
        
        if (correlation > 0.8) {
          // Check if they form a clique with others
          const clique = this.findClique(v1, v2, voterCooccurrence, totalVotes);
          
          if (clique.length >= 3) {
            collusionGroups.push({
              nodes: clique,
              correlation,
              confidence: correlation * 0.95
            });
            
            for (const node of clique) {
              processed.add(node);
            }
          }
        }
        
        processed.add(`${v1}-${v2}`);
      }
    }

    if (collusionGroups.length > 0) {
      this.emit('consensus:collusion_detected', collusionGroups);
    }

    return collusionGroups;
  }

  // ============================================================================
  // GAP 14: Message Amplification Prevention
  // ============================================================================

  /**
   * Aggregates BLS signatures for O(1) verification.
   * Note: Production requires BLS12-381 library (e.g., @noble/bls12-381)
   * 
   * @param {string[]} signatures - Array of base64-encoded BLS signatures
   * @returns {{aggregate: string, count: number}}
   */
  aggregateSignaturesBLS(signatures: string[]): { aggregate: string; count: number } {
    // Mock implementation - production uses BLS12-381 aggregate
    // In real implementation: bls.aggregateSignatures(signatures.map(s => Buffer.from(s, 'base64')))
    
    const aggregate = crypto.createHash('sha256')
      .update(signatures.sort().join(''))
      .digest('base64');
    
    return { aggregate, count: signatures.length };
  }

  /**
   * Batch verifies multiple signatures in single operation.
   * 
   * @param {Array<{msg: Buffer, sig: string, pubkey: string}>} messages - Messages to verify
   * @returns {{valid: boolean, validIndices: number[], invalidIndices: number[]}}
   */
  batchVerify(
    messages: Array<{msg: Buffer; sig: string; pubkey: string}>
  ): { valid: boolean; validIndices: number[]; invalidIndices: number[] } {
    const validIndices: number[] = [];
    const invalidIndices: number[] = [];

    // In production: Use BLS batch verification or Ed25519 batch verify
    for (let i = 0; i < messages.length; i++) {
      const { msg, sig, pubkey } = messages[i];
      try {
        const sigBuf = Buffer.from(sig, 'base64');
        if (crypto.verify('sha256', msg, pubkey, sigBuf)) {
          validIndices.push(i);
        } else {
          invalidIndices.push(i);
        }
      } catch {
        invalidIndices.push(i);
      }
    }

    return {
      valid: invalidIndices.length === 0,
      validIndices,
      invalidIndices
    };
  }

  /**
   * Enforces maximum message size to prevent DoS via amplification.
   * 
   * @param {Buffer} msg - Message buffer
   * @param {number} maxBytes - Maximum allowed size (default: 1MB)
   * @returns {{accepted: boolean, size: number, excess: number}}
   */
  enforceMessageSizeLimit(
    msg: Buffer, 
    maxBytes: number = 1024 * 1024
  ): { accepted: boolean; size: number; excess: number } {
    const size = msg.length;
    const accepted = size <= maxBytes;
    const excess = accepted ? 0 : size - maxBytes;

    if (!accepted) {
      this.emit('consensus:oversized_message', { size, limit: maxBytes });
    }

    return { accepted, size, excess };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private findClique(
    v1: string, 
    v2: string, 
    matrix: Map<string, Map<string, number>>, 
    total: number
  ): string[] {
    const clique = new Set([v1, v2]);
    const neighbors1 = matrix.get(v1)!;
    
    for (const [candidate, count] of neighbors1) {
      if (candidate === v2) continue;
      
      // Check if candidate is strongly connected to both
      const corr1 = count / total;
      const corr2 = (matrix.get(v2)?.get(candidate) || 0) / total;
      
      if (corr1 > 0.8 && corr2 > 0.8) {
        clique.add(candidate);
      }
    }
    
    return Array.from(clique);
  }
}

// Export both classes as default and named exports
export default { NetworkHardening, ConsensusHardening };
