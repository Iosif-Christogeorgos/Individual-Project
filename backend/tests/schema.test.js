// Runs schema.sql on a real Postgres engine (PGlite) and checks its security rules.
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const schemaPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../schema.sql",
);
const schema = fs.readFileSync(schemaPath, "utf8");

// The parts of a Supabase project that schema.sql relies on
const SUPABASE_STUB = `
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id UUID PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql AS 'SELECT NULL::UUID';
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
`;

const FILE_ID = `file-${"a".repeat(64)}.bin`;
let db;

async function asRole(role, query) {
  await db.exec(`SET ROLE ${role}`);
  try {
    return await db.query(query);
  } finally {
    await db.exec("RESET ROLE");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(schema);
  await db.query(
    `INSERT INTO files (id, size, content_hash, expires_at, metadata)
     VALUES ($1, 10, 'hash', NOW() + INTERVAL '1 day',
             '{"contentHash":"hash","size":10,"version":2}')`,
    [FILE_ID],
  );
}, 60000);

describe("schema.sql", () => {
  it("can be re-run on an existing database", async () => {
    await expect(db.exec(schema)).resolves.toBeDefined();
  });

  it.each([
    ["expiry", "expires_at = NOW() + INTERVAL '10 years'", "File expiry is immutable"],
    ["content hash", "content_hash = 'other'", "content_hash is immutable"],
    ["size", "size = 11", "File size is immutable"],
    [
      "metadata hash",
      `metadata = metadata || '{"contentHash":"other"}'`,
      "metadata.contentHash is immutable",
    ],
  ])("blocks changes to the %s", async (_name, assignment, message) => {
    await expect(
      db.query(`UPDATE files SET ${assignment} WHERE id = $1`, [FILE_ID]),
    ).rejects.toThrow(message);
  });

  it("hides expired files from get_file_metadata", async () => {
    const expiredId = `file-${"b".repeat(64)}.bin`;
    await db.query(
      `INSERT INTO files (id, size, expires_at, metadata)
       VALUES ($1, 1, NOW() - INTERVAL '1 hour', '{}')`,
      [expiredId],
    );
    const expired = await db.query("SELECT * FROM get_file_metadata($1)", [expiredId]);
    expect(expired.rows).toHaveLength(0);

    const active = await db.query("SELECT * FROM get_file_metadata($1)", [FILE_ID]);
    expect(active.rows).toHaveLength(1);
  });

  it("consumes upload tokens exactly once", async () => {
    await db.query(
      `INSERT INTO upload_tokens (file_id, token_hash, expires_at)
       VALUES ('f1', 'tok', NOW() + INTERVAL '1 hour')`,
    );
    const consume = (hash) =>
      db.query("SELECT consume_upload_token('f1', $1) AS ok", [hash]);

    expect((await consume("wrong")).rows[0].ok).toBe(false);
    expect((await consume("tok")).rows[0].ok).toBe(true);
    expect((await consume("tok")).rows[0].ok).toBe(false);
  });

  it("consumes ownership nonces exactly once", async () => {
    const consume = () => db.query("SELECT consume_ownership_nonce('n1') AS ok");
    expect((await consume()).rows[0].ok).toBe(true);
    expect((await consume()).rows[0].ok).toBe(false);
  });

  it("removes recipient keys along with their file", async () => {
    const id = `file-${"c".repeat(64)}.bin`;
    await db.query(
      `INSERT INTO files (id, size, expires_at, metadata)
       VALUES ($1, 1, NOW() + INTERVAL '1 hour', '{}')`,
      [id],
    );
    await db.query(
      `INSERT INTO file_recipients (file_id, recipient_fingerprint, encrypted_key)
       VALUES ($1, 'fp', '{}')`,
      [id],
    );
    await db.query("DELETE FROM files WHERE id = $1", [id]);
    const left = await db.query("SELECT * FROM file_recipients WHERE file_id = $1", [id]);
    expect(left.rows).toHaveLength(0);
  });

  describe.each(["anon", "authenticated"])("the %s role", (role) => {
    it.each([
      ["get_file_metadata('x')"],
      ["get_encrypted_key_for_recipient('x', 'y')"],
      ["consume_upload_token('x', 'y')"],
      ["consume_ownership_nonce('x')"],
      ["cleanup_expired_nonces()"],
    ])("can't call %s", async (call) => {
      await expect(asRole(role, `SELECT ${call}`)).rejects.toThrow("permission denied");
    });

    it.each([["public_keys"], ["files"], ["file_recipients"], ["upload_tokens"]])(
      "can't read %s",
      async (table) => {
        await db.exec(`GRANT SELECT ON ${table} TO ${role}`); // Supabase's default
        const result = await asRole(role, `SELECT * FROM ${table}`);
        expect(result.rows).toHaveLength(0);
      },
    );
  });

  it("the service role can call the functions the backend needs", async () => {
    for (const call of [
      `get_file_metadata('${FILE_ID}')`,
      "get_encrypted_key_for_recipient('x', 'y')",
      "consume_upload_token('x', 'y')",
      "consume_ownership_nonce('service-role-check')",
    ]) {
      await expect(asRole("service_role", `SELECT ${call}`)).resolves.toBeDefined();
    }
  });
});
