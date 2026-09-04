import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const overridePath = "docker/clickhouse/config.d/low-disk-write.xml";
const override = readFileSync(join(root, overridePath), "utf8");
const clientSource = readFileSync(join(root, "src/lib/clickhouse/client.ts"), "utf8");
const compose = readFileSync(join(root, "docker-compose.yml"), "utf8");

/** Log tables turned off by the config override, e.g. `<metric_log remove="1"/>`. */
function overrideDisabledLogs(): string[] {
  return [...override.matchAll(/<([a-z_]+_log)\s+remove="1"\s*\/>/g)].map((m) => m[1]).sort();
}

/** The DISABLED_SYSTEM_LOGS array literal in client.ts, which drives the reclaim DROP. */
function clientDisabledLogs(): string[] {
  const block = clientSource.match(/const DISABLED_SYSTEM_LOGS = \[([\s\S]*?)\] as const;/);
  if (!block) throw new Error("DISABLED_SYSTEM_LOGS not found in src/lib/clickhouse/client.ts");
  return [...block[1].matchAll(/'([a-z_]+_log)'/g)].map((m) => m[1]).sort();
}

describe("ClickHouse diagnostic system logs stay disabled", () => {
  // The outage this guards: docker-compose bind-mounted `./config.d`, a path that
  // does not exist in the repo. Docker silently created an empty directory and
  // mounted it over /etc/clickhouse-server/config.d, so no override applied and
  // metric_log alone wrote gigabytes a week on idle servers. Mounting the files
  // individually fails loudly instead when a path is wrong.
  it("mounts each override file individually, never the whole config.d directory", () => {
    expect(compose).toContain(`./${overridePath}:/etc/clickhouse-server/${overridePath.replace("docker/clickhouse/", "")}`);
    expect(compose).not.toMatch(/-\s*\.?[\w./]*\/?config\.d:\/etc\/clickhouse-server\/config\.d/);
  });

  it("disables every system log that ClickHouse flushes on a timer", () => {
    // These flush every 7.5s regardless of traffic on a stock server. metric_log
    // is the worst by far: ~1.3 MiB per four idle minutes because it carries one
    // column per ProfileEvent.
    const periodicWriters = [
      "metric_log",
      "asynchronous_metric_log",
      "error_log",
      "query_metric_log",
      "background_schedule_pool_log",
      "asynchronous_insert_log",
      "trace_log",
      "text_log",
      "part_log",
      "query_log",
    ];
    expect(overrideDisabledLogs()).toEqual(expect.arrayContaining(periodicWriters));
  });

  it("keeps crash_log, which only writes when the server actually crashes", () => {
    expect(overrideDisabledLogs()).not.toContain("crash_log");
  });

  // Disabling only stops new writes; deployments that already ballooned reclaim
  // their disk when initClickHouse drops these tables. A name missing from the
  // client list leaks the old data forever, so the two must agree exactly.
  it("keeps the reclaim list in client.ts in sync with the config override", () => {
    expect(clientDisabledLogs()).toEqual(overrideDisabledLogs());
  });
});
