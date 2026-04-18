/**
 * HODL Crypto Utilities (preimage/hash generation)
 * @module payments/hodl/crypto
 */
import { createHash, randomBytes } from 'crypto';

export function generatePreimageAndHash(): {
  preimage: string;
  paymentHash: string;
} {
  const preimage = randomBytes(32).toString('hex');
  const paymentHash = createHash('sha256')
    .update(Buffer.from(preimage, 'hex'))
    .digest('hex');
  return { preimage, paymentHash };
}

export function hashFromPreimage(preimage: string): string {
  return createHash('sha256')
    .update(Buffer.from(preimage, 'hex'))
    .digest('hex');
}
