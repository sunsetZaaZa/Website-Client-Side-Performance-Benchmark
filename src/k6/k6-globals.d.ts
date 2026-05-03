declare const __ENV: Record<string, string | undefined>;
declare const __ITER: number;

declare function open(filePath: string): string;

declare module 'k6' {
  export function check(value: unknown, sets: Record<string, (value: unknown) => boolean>, tags?: Record<string, string>): boolean;
  export function sleep(seconds: number): void;
}

declare module 'k6/http' {
  export interface Response {
    status: number;
    timings: Record<string, number>;
    body: string | null;
    url: string;
  }

  export interface RequestParams {
    tags?: Record<string, string>;
    headers?: Record<string, string>;
    timeout?: string;
  }

  export function get(url: string, params?: RequestParams): Response;

  const http: {
    get: typeof get;
  };

  export default http;
}
