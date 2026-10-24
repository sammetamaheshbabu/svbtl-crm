import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// SVBTL fork: migration 904 decides what agents may change. These checks
// fail if a policy loses its admin requirement or a later migration
// redefines it.

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), "utf8").replace(/\r\n/g, "\n") }));

/** The last `CREATE POLICY <name>` statement across all migrations. */
function latestPolicy(name: string): { file: string; sql: string } {
  const header = new RegExp(`create\\s+policy\\s+${name}\\s`, "i");
  const latest = migrations.filter(({ sql }) => header.test(sql)).at(-1);
  if (!latest) throw new Error(`policy ${name} not found`);
  const start = latest.sql.search(header);
  return { file: latest.name, sql: latest.sql.slice(start, latest.sql.indexOf(";", start)) };
}

const ADMIN_ONLY = [
  "broadcasts_insert", "broadcasts_update", "broadcasts_delete", "broadcast_recipients_modify",
  "automations_insert", "automations_update", "automations_delete", "automation_steps_modify",
  "flows_insert", "flows_update", "flows_delete", "flow_nodes_modify",
  "contacts_delete", "deals_delete",
];

describe("migration 904 — agent restrictions", () => {
  it.each(ADMIN_ONLY)("%s needs admin and is last defined by 904", (name) => {
    const policy = latestPolicy(name);
    expect(policy.file).toBe("904_agent_restrictions.sql");
    expect(policy.sql).toMatch(/is_account_member\([a-z_.]+, 'admin'\)/);
    expect(policy.sql).not.toMatch(/'agent'/);
  });

  it("keeps adding and editing contacts open to agents", () => {
    expect(latestPolicy("contacts_insert").sql).toMatch(/'agent'/);
    expect(latestPolicy("contacts_update").sql).toMatch(/'agent'/);
  });

  it("scopes which contacts an agent sees", () => {
    const policy = latestPolicy("contacts_select");
    expect(policy.file).toBe("904_agent_restrictions.sql");
    expect(policy.sql).toMatch(/can_see_contact\(id, account_id\)/);
    const fn = migrations.find((m) => m.name === "904_agent_restrictions.sql")!.sql;
    // Must bypass the conversations policy, or another agent's customer
    // would look like a contact with no chat.
    expect(fn).toMatch(/FUNCTION public\.can_see_contact[\s\S]*SECURITY DEFINER/);
    expect(fn).toMatch(/assigned_agent_id IS NULL OR c\.assigned_agent_id = auth\.uid\(\)/);
  });

  it("allows handover requests as notifications", () => {
    const fn = migrations.find((m) => m.name === "904_agent_restrictions.sql")!.sql;
    expect(fn).toMatch(/CHECK \(type IN \('conversation_assigned', 'handover_requested'\)\)/);
  });
});

describe("write routes for broadcasts, automations and flows", () => {
  const routes = [
    "src/app/api/automations/route.ts",
    "src/app/api/automations/[id]/route.ts",
    "src/app/api/automations/[id]/duplicate/route.ts",
    "src/app/api/automations/engine/route.ts",
    "src/app/api/flows/route.ts",
    "src/app/api/flows/[id]/route.ts",
    "src/app/api/flows/[id]/activate/route.ts",
    "src/app/api/whatsapp/broadcast/route.ts",
    "src/app/api/whatsapp/broadcast/[id]/resume/route.ts",
  ];
  it.each(routes)("%s requires admin for every write", (path) => {
    const source = readFileSync(join(process.cwd(), path), "utf8");
    const calls = [...source.matchAll(/await requireRole\('(\w+)'\)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((role) => role === "admin")).toBe(true);
  });

  it("lets agents sync templates", () => {
    const source = readFileSync(join(process.cwd(), "src/app/api/whatsapp/templates/sync/route.ts"), "utf8");
    expect(source).toMatch(/await requireRole\('agent'\)/);
  });
});
