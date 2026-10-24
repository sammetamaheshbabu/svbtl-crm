import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// SVBTL fork: agents see only their own and unassigned chats (migration
// 900), so the dashboard's lists of customer details must too (903).

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  // Line endings depend on the checkout (Windows gives CRLF).
  .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), "utf8").replace(/\r\n/g, "\n") }));

function functionBodies(functionName: string): { name: string; body: string }[] {
  const header = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}\\s*\\(`, "i");
  return migrations
    .filter(({ sql }) => header.test(sql))
    .map(({ name, sql }) => {
      const start = sql.search(header);
      const bodyStart = sql.indexOf("$$", start);
      const bodyEnd = sql.indexOf("$$", bodyStart + 2);
      return { name, body: sql.slice(bodyStart + 2, bodyEnd) };
    });
}

const visible = "(v_sees_all OR assigned_agent_id IS NULL OR assigned_agent_id = auth.uid())";

describe("dashboard_overview agent scope", () => {
  const bodies = functionBodies("dashboard_overview");
  const latest = bodies.at(-1)!;

  it("is last defined by the fork's migration", () => {
    expect(latest.name).toBe("903_dashboard_agent_scope.sql");
  });

  it("filters the queue and the failed-messages list for agents", () => {
    expect(latest.body).toContain("v_sees_all := is_account_member(v_account, 'admin');");
    expect(latest.body).toContain(`FROM (SELECT * FROM awaiting WHERE ${visible} ORDER BY waiting_since LIMIT 6) q`);
    expect(latest.body).toContain(`FROM (SELECT * FROM failed WHERE ${visible} ORDER BY created_at DESC LIMIT 10) f`);
  });

  it("is otherwise upstream's function, so an upstream change shows up here", () => {
    const upstream = bodies.at(-2)!.body;
    const unfiltered = latest.body
      .replace("  v_sees_all BOOLEAN;\n", "")
      .replace("  v_sees_all := is_account_member(v_account, 'admin');\n\n", "")
      .replace(", c.assigned_agent_id\n", "\n")
      .replaceAll(` WHERE ${visible}`, "");
    expect(unfiltered).toBe(upstream);
  });
});
