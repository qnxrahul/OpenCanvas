const { Pool } = require('pg');
const { registerTypes: registerVectorTypes } = require('pgvector/pg');

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD
});

async function initDb() {
  // First, verify DB connectivity; if unavailable, bubble up so caller can decide.
  await pool.query('SELECT 1').catch((e: unknown) => { throw e; });

  // Register pgvector types (best-effort) and ensure required extensions (best-effort)
  await registerVectorTypes(pool).catch(() => {});
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`).catch(() => {});
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`).catch(() => {});
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text UNIQUE,
      name text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS memberships (
      user_id uuid REFERENCES users(id) ON DELETE CASCADE,
      workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
      role text NOT NULL DEFAULT 'editor',
      PRIMARY KEY (user_id, workspace_id)
    );
    CREATE TABLE IF NOT EXISTS canvases (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
      title text,
      data jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS threads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
      canvas_id uuid REFERENCES canvases(id) ON DELETE SET NULL,
      title text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id uuid REFERENCES threads(id) ON DELETE CASCADE,
      role text NOT NULL,
      content text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS docs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
      title text,
      content jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
      title text,
      data jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sources (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
      kind text NOT NULL, -- file|url
      url text,
      filename text,
      mime text,
      meta jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_id uuid REFERENCES sources(id) ON DELETE CASCADE,
      workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
      content text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}',
      embedding vector(1536)
    );
    CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING ivfflat (embedding vector_cosine_ops);
  `);
}

module.exports = { pool, initDb };

