import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
// @ts-ignore - grpc types not available in this workspace
import * as grpc from '@grpc/grpc-js';
// @ts-ignore
import * as protoLoader from '@grpc/proto-loader';
const createServer = grpc.Server;

const bip32 = BIP32Factory(ecc);
bitcoin.initEccLib(ecc);
const NETWORK = bitcoin.networks.testnet;

export interface Wallet { mnemonic: string; xpub: string; xprv: string; fingerprint: string; }
export interface Address { address: string; path: string; publicKey: string; internalKey: string; }

export function createWallet(): Wallet {
  const m = bip39.generateMnemonic(256);
  const r = bip32.fromSeed(bip39.mnemonicToSeedSync(m), NETWORK);
  return { mnemonic: m, xpub: r.neutered().toBase58(), xprv: r.toBase58(), fingerprint: r.fingerprint.toString('hex') };
}

export function restore(mnemonic: string): Wallet {
  if (!bip39.validateMnemonic(mnemonic)) throw new Error('Invalid');
  const r = bip32.fromSeed(bip39.mnemonicToSeedSync(mnemonic), NETWORK);
  return { mnemonic, xpub: r.neutered().toBase58(), xprv: r.toBase58(), fingerprint: r.fingerprint.toString('hex') };
}

export function derive(xprvOrM: string, path = 'm/86\'/1\'/0\'/0/0'): Address {
  const root = xprvOrM.includes(' ') ? bip32.fromSeed(bip39.mnemonicToSeedSync(xprvOrM), NETWORK) : bip32.fromBase58(xprvOrM, NETWORK);
  const c = root.derivePath(path);
  const k = c.publicKey!.slice(1, 33);
  return { address: bitcoin.payments.p2tr({ internalPubkey: Buffer.from(k), network: NETWORK }).address!, path, publicKey: c.publicKey!.toString('hex'), internalKey: k.toString('hex') };
}

export function deriveRange(x: string, start = 0, n = 10) {
  return Array.from({ length: n }, (_, i) => derive(x, `m/86'/1'/0'/0/${start + i}`));
}

export function sign(xprvOrM: string, msg: string, path = 'm/86\'/1\'/0\'/0/0') {
  const root = xprvOrM.includes(' ') ? bip32.fromSeed(bip39.mnemonicToSeedSync(xprvOrM), NETWORK) : bip32.fromBase58(xprvOrM, NETWORK);
  return Buffer.from(ecc.sign(bitcoin.crypto.sha256(Buffer.from(msg)), root.derivePath(path).privateKey!)).toString('hex');
}

export function verify(pk: string, msg: string, sig: string) {
  try { return ecc.verify(bitcoin.crypto.sha256(Buffer.from(msg)), Buffer.from(pk, 'hex'), Buffer.from(sig, 'hex')); } catch { return false; }
}

export function startServer(port = 50051) {
  const proto = protoLoader.loadSync('/proto/identity.proto', { defaults: true });
  const srv = new grpc.Server();
  const pkgDef = grpc.loadPackageDefinition(proto);
  const pkg = (pkgDef as any).IdentityService.service;
  srv.addService(pkg, {
    CreateWallet: (_: any, cb: any) => { const w = createWallet(); cb(null, { mnemonic: w.mnemonic, xpub: w.xpub, fingerprint: w.fingerprint }); },
    RestoreWallet: (c: any, cb: any) => { try { const w = restore(c.request.mnemonic); cb(null, { mnemonic: w.mnemonic, xpub: w.xpub, fingerprint: w.fingerprint }); } catch { cb({ code: 3 }, null); } },
    DeriveAddress: (c: any, cb: any) => { try { const a = derive(c.request.xprv, c.request.path); cb(null, { address: a.address, path: a.path, public_key: a.publicKey }); } catch { cb({ code: 3 }, null); } },
    SignMessage: (c: any, cb: any) => { try { cb(null, { signature: sign(c.request.xprv, c.request.message, c.request.path) }); } catch { cb({ code: 3 }, null); } },
    VerifyMessage: (c: any, cb: any) => { cb(null, { valid: verify(c.request.public_key, c.request.message, c.request.signature) }); }
  });
  srv.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), () => srv.start());
  return srv;
}

// @ts-ignore
if (typeof import.meta !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  const w = createWallet();
  const a = derive(w.mnemonic);
  const s = sign(w.mnemonic, 'test');
  console.log('✓ Wallet:', w.fingerprint, '| P2TR:', a.address.slice(0, 25) + '...', '| Verified:', verify(a.publicKey, 'test', s));
}
