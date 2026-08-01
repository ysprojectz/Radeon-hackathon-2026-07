import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");

function readConfig(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("nginx auth route limits", () => {
  test("production config keeps proxied session checks out of the login bucket", () => {
    const config = readConfig("nginx/nginx.conf");
    const sessionCheck = config.indexOf("location = /api/v1/proxy/auth/me");
    const authBucket = config.indexOf("location ~ ^/api/v1/proxy/auth/");

    expect(sessionCheck).toBeGreaterThan(-1);
    expect(authBucket).toBeGreaterThan(-1);
    expect(sessionCheck).toBeLessThan(authBucket);

    const sessionBlock = config.slice(sessionCheck, authBucket);
    expect(sessionBlock).toContain("limit_req zone=api burst=20 nodelay;");
    expect(sessionBlock).not.toContain("limit_req zone=login");
  });

  test("production config keeps direct session checks out of the login bucket", () => {
    const config = readConfig("nginx/nginx.conf");
    const sessionCheck = config.indexOf("location = /api/v1/auth/me");
    const loginEndpoint = config.indexOf("location = /api/v1/auth/login");
    const proxiedSessionCheck = config.indexOf("location = /api/v1/proxy/auth/me");

    expect(sessionCheck).toBeGreaterThan(loginEndpoint);
    expect(sessionCheck).toBeLessThan(proxiedSessionCheck);

    const sessionBlock = config.slice(sessionCheck, proxiedSessionCheck);
    expect(sessionBlock).toContain("limit_req zone=api burst=20 nodelay;");
    expect(sessionBlock).not.toContain("limit_req zone=login");
  });

  test("ssl config keeps direct session checks out of the auth bucket", () => {
    const config = readConfig("nginx/nginx.ssl.conf");
    const sessionCheck = config.indexOf("location = /api/v1/auth/me");
    const authBucket = config.indexOf("location ~ ^/api/v1/auth/");

    expect(sessionCheck).toBeGreaterThan(-1);
    expect(authBucket).toBeGreaterThan(-1);
    expect(sessionCheck).toBeLessThan(authBucket);

    const sessionBlock = config.slice(sessionCheck, authBucket);
    expect(sessionBlock).toContain("limit_req zone=api_limit burst=20 nodelay;");
    expect(sessionBlock).not.toContain("limit_req zone=auth_limit");
  });
});
