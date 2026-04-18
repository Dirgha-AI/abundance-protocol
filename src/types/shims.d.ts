// Type shims for packages without @types in this workspace
declare module 'cors' {
  import { RequestHandler } from 'express';
  function cors(options?: any): RequestHandler;
  export = cors;
}

declare module 'helmet' {
  import { RequestHandler } from 'express';
  function helmet(options?: any): RequestHandler;
  export = helmet;
}
