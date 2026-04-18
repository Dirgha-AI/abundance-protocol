declare module 'ln-service' {
  export function authenticatedLndGrpc(config: { socket: string; macaroon: string; cert?: string }): any;
  export function getWalletInfo(args: { lnd: any }): Promise<any>;
  export function createInvoice(args: { lnd: any; tokens: number; description?: string }): Promise<any>;
  export function payViaPaymentRequest(args: { lnd: any; request: string }): Promise<any>;
  export function getChannels(args: { lnd: any }): Promise<any>;
  export function openChannel(args: { lnd: any; local_tokens: number; partner_public_key: string }): Promise<any>;
  export function queryRoutes(args: { lnd: any; destination: string; tokens: number }): Promise<any>;
}
