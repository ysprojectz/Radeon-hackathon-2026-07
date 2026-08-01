import { test, expect, beforeEach, afterEach } from '@jest/globals';

jest.mock('next/server', () => {
  class MockNextResponse {
    headers: Headers;
    status: number;

    constructor(_body: unknown = null, init?: ResponseInit) {
      void _body;
      this.headers = new Headers(init?.headers);
      this.status = init?.status ?? 200;
    }

    static json(_body: unknown, init?: ResponseInit) {
      return new MockNextResponse(_body, init);
    }
  }

  return { NextResponse: MockNextResponse };
});

import { sameOriginGuard } from '@/lib/server-security';

// Mock NextRequest
const createMockRequest = (origin: string | null = null) => {
  const headers = new Headers();
  if (origin) {
    headers.set('origin', origin);
  }
  
  return {
    headers,
    nextUrl: {
      origin: 'http://localhost:3000',
    },
  } as Parameters<typeof sameOriginGuard>[0];
};

describe('Security Headers - sameOriginGuard', () => {
  const originalEnv = process.env.NEXT_PUBLIC_API_URL;
  
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:8000';
    jest.useFakeTimers();
  });
  
  afterEach(() => {
    process.env.NEXT_PUBLIC_API_URL = originalEnv;
    jest.restoreAllMocks();
  });

  test('should allow same-origin requests (no origin header)', () => {
    const req = createMockRequest(null);
    const result = sameOriginGuard(req);
    expect(result).toBeNull();
  });

  test('should allow same-origin requests with matching origin', () => {
    const req = createMockRequest('http://localhost:3000');
    const result = sameOriginGuard(req);
    expect(result).toBeNull();
  });

  test('should block cross-origin requests with different origin', () => {
    const req = createMockRequest('http://evil.com');
    const result = sameOriginGuard(req);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.status).toBe(403);
    }
  });

  test('should handle invalid origin header gracefully', () => {
    const req = createMockRequest('invalid-origin');
    const result = sameOriginGuard(req);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.status).toBe(403);
    }
  });
});
