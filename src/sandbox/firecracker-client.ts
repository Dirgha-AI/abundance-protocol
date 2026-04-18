/**
 * Firecracker API Client
 * HTTP client over Unix domain socket
 */

import * as http from 'http';

export class FirecrackerAPI {
  constructor(private socketPath: string) {}

  private request(method: string, path: string, body?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        socketPath: this.socketPath,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            }
          } catch {
            resolve(data);
          }
        });
      });

      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async put(path: string, body: any): Promise<any> {
    return this.request('PUT', path, body);
  }

  async get(path: string): Promise<any> {
    return this.request('GET', path);
  }

  async patch(path: string, body: any): Promise<any> {
    return this.request('PATCH', path, body);
  }
}
