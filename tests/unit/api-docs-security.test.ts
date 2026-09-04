import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCsp } from "@/src/lib/csp";

const root = resolve(import.meta.dirname, "../..");

describe("API documentation asset security", () => {
  it("allows only same-origin executable scripts in the authenticated CSP", () => {
    const csp = buildCsp("test-nonce");
    const scriptDirective = csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("script-src"));

    expect(scriptDirective).toBe("script-src 'self' 'nonce-test-nonce'");
    expect(csp).not.toContain("cdn.jsdelivr.net");
  });

  it("uses an exact, bundled Swagger UI dependency instead of runtime CDN injection", () => {
    const component = readFileSync(
      resolve(root, "app/(dashboard)/api-docs/ApiDocsClient.tsx"),
      "utf8"
    );
    const packageJson = JSON.parse(
      readFileSync(resolve(root, "package.json"), "utf8")
    ) as { dependencies?: Record<string, string> };
    const version = packageJson.dependencies?.["swagger-ui-react"];

    expect(component).toContain('from "swagger-ui-react"');
    expect(component).not.toMatch(/https?:\/\//);
    expect(component).not.toMatch(/createElement\(["']script["']\)/);
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
