import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// SVBTL fork: migration 906 decides who sees and who may set a callback
// reminder. These checks fail if a policy loses its scoping or a later
// migration quietly redefines it — the same guard 904 has.

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({
    name,
    sql: readFileSync(join(migrationsDir, name), 'utf8').replace(/\r\n/g, '\n'),
  }));

const MIGRATION = '906_contact_reminders.sql';

/** The last `CREATE POLICY <name>` statement across all migrations. */
function latestPolicy(name: string): { file: string; sql: string } {
  const header = new RegExp(`create\\s+policy\\s+${name}\\s`, 'i');
  const latest = migrations.filter(({ sql }) => header.test(sql)).at(-1);
  if (!latest) throw new Error(`policy ${name} not found`);
  const start = latest.sql.search(header);
  return {
    file: latest.name,
    sql: latest.sql.slice(start, latest.sql.indexOf(';', start)),
  };
}

const sql = () => migrations.find((m) => m.name === MIGRATION)!.sql;

describe('migration 906 — callback reminders', () => {
  it('ships as a fork migration in the 900 range', () => {
    expect(migrations.map((m) => m.name)).toContain(MIGRATION);
  });

  it('turns on row-level security', () => {
    expect(sql()).toMatch(
      /ALTER TABLE contact_reminders ENABLE ROW LEVEL SECURITY/i
    );
  });

  it.each([
    'contact_reminders_select',
    'contact_reminders_insert',
    'contact_reminders_update',
    'contact_reminders_delete',
  ])('%s is last defined by 906', (name) => {
    expect(latestPolicy(name).file).toBe(MIGRATION);
  });

  it('lets admins see everything and agents only their own', () => {
    const policy = latestPolicy('contact_reminders_select').sql;
    expect(policy).toMatch(/is_account_member\(account_id, 'admin'\)/);
    expect(policy).toMatch(/agent_id = auth\.uid\(\)/);
  });

  it('stops an agent filing a reminder under someone else’s name', () => {
    // Reminders are deliberately not assignable: the person who gave
    // their word is the person who owns it.
    const policy = latestPolicy('contact_reminders_insert').sql;
    expect(policy).toMatch(/is_account_member\(account_id, 'agent'\)/);
    expect(policy).toMatch(/agent_id = auth\.uid\(\)/);
  });

  it.each(['contact_reminders_update', 'contact_reminders_delete'])(
    '%s is yours or an admin’s',
    (name) => {
      const policy = latestPolicy(name).sql;
      expect(policy).toMatch(/is_account_member\(account_id, 'admin'\)/);
      expect(policy).toMatch(/agent_id = auth\.uid\(\)/);
    }
  );

  it('keeps the partial index the due-drain relies on', () => {
    expect(sql()).toMatch(
      /idx_contact_reminders_due[\s\S]*?\(remind_at\) WHERE status = 'pending'/i
    );
  });

  it('adds reminder_due to the notification whitelist, keeping the others', () => {
    // The whitelist is a CHECK, not an enum, so it is rebuilt whole —
    // dropping a value here would silently break another feature.
    expect(sql()).toMatch(
      /CHECK \(type IN \('conversation_assigned', 'handover_requested', 'reminder_due'\)\)/
    );
  });

  it('is the last migration to define the notification whitelist', () => {
    const owners = migrations.filter(({ sql: body }) =>
      /ADD CONSTRAINT notifications_type_check/i.test(body)
    );
    expect(owners.at(-1)!.name).toBe(MIGRATION);
  });

  it('notifies through a SECURITY DEFINER function, since clients cannot', () => {
    // Migration 027 grants clients UPDATE (read_at) on notifications and
    // nothing else, so the job has to run as definer to insert at all.
    expect(sql()).toMatch(
      /FUNCTION public\.notify_due_reminders\(\)[\s\S]*?SECURITY DEFINER/
    );
    expect(sql()).toMatch(/SET search_path = public/);
  });

  it('claims rows in the same statement that notifies on them', () => {
    // UPDATE ... RETURNING is the lock: a row leaves 'pending' as it is
    // notified, so two overlapping runs cannot both pick it up.
    const body = sql();
    expect(body).toMatch(
      /UPDATE contact_reminders[\s\S]*?WHERE status = 'pending' AND remind_at <= now\(\)[\s\S]*?RETURNING/
    );
  });

  it('keeps the function away from anon', () => {
    expect(sql()).toMatch(
      /REVOKE ALL ON FUNCTION public\.notify_due_reminders\(\) FROM PUBLIC, anon/
    );
  });

  it('does not fail CI, where pg_cron is not installed', () => {
    // The throwaway Postgres that replays these migrations has no
    // pg_cron; an unguarded cron.schedule() would fail the whole run.
    const body = sql();
    // Match the call itself, not the comment above it explaining why.
    const scheduleAt = body.search(/PERFORM cron\.schedule\(/);
    const guardAt = body.search(/pg_extension WHERE extname = 'pg_cron'/);
    expect(scheduleAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(scheduleAt);
  });

  it('is re-runnable', () => {
    const body = sql();
    expect(body).toMatch(/CREATE TABLE IF NOT EXISTS contact_reminders/i);
    for (const name of [
      'contact_reminders_select',
      'contact_reminders_insert',
      'contact_reminders_update',
      'contact_reminders_delete',
    ]) {
      expect(body).toMatch(
        new RegExp(`DROP POLICY IF EXISTS ${name} ON contact_reminders`, 'i')
      );
    }
    expect(body).toMatch(/CREATE OR REPLACE FUNCTION public\.notify_due_reminders/);
    // Re-running must replace the schedule, not add a second one.
    expect(body).toMatch(/cron\.unschedule\('notify-due-reminders'\)/);
  });
});
