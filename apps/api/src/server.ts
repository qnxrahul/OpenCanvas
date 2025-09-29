require('dotenv/config');
import type { Request, Response } from 'express';
const express = require('express');
const cors = require('cors');
const { z } = require('zod');
const fetch = require('node-fetch');
const multer = require('multer');
const { initDb, pool } = require('./db');
const { ensureBucket, s3 } = require('./storage');
const { toSql } = require('pgvector');

const app = express();
app.use(cors());
// basic request logging
app.use((req: Request, _res: Response, next: any) => {
  const start = Date.now();
  (_res as any).on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.url} ${(_res as any).statusCode} ${ms}ms`);
  });
  next();
});
app.use(express.json({ limit: '2mb' }));

const OpenRouterSchema = z.object({
  model: z.string().default('openai/gpt-4o-mini'),
  messages: z.array(z.object({ role: z.enum(['system','user','assistant']), content: z.string() })),
  stream: z.boolean().optional()
});

// Canvases CRUD & templates
// Workspaces minimal CRUD
app.post('/v1/workspaces', async (req: Request, res: Response) => {
  try {
    const { name } = req.body || {};
    const { rows } = await pool.query('INSERT INTO workspaces (name) VALUES ($1) RETURNING id', [name || 'Workspace']);
    res.json({ id: rows[0].id });
  } catch (e: any) { res.status(500).json({ error: String(e) }); }
});

app.get('/v1/workspaces', async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query('SELECT * FROM workspaces ORDER BY created_at DESC');
    res.json({ items: rows });
  } catch (e: any) { res.status(500).json({ error: String(e) }); }
});

app.post('/v1/canvases', async (req: Request, res: Response) => {
  try {
    const { workspaceId, title, data } = req.body || {};
    const { rows } = await pool.query('INSERT INTO canvases (workspace_id, title, data) VALUES ($1,$2,$3) RETURNING id', [workspaceId, title || null, data || {}]);
    res.json({ id: rows[0].id });
  } catch (e: any) { res.status(500).json({ error: String(e) }); }
});

app.get('/v1/canvases', async (req: Request, res: Response) => {
  try {
    const workspaceId = String(req.query.workspaceId || '');
    const { rows } = await pool.query('SELECT * FROM canvases WHERE workspace_id=$1 ORDER BY updated_at DESC', [workspaceId]);
    res.json({ items: rows });
  } catch (e: any) { res.status(500).json({ error: String(e) }); }
});

app.put('/v1/canvases/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const { title, data } = req.body || {};
    await pool.query('UPDATE canvases SET title = COALESCE($1,title), data = COALESCE($2,data), updated_at = now() WHERE id=$3', [title, data, id]);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: String(e) }); }
});

app.post('/v1/templates', async (req: Request, res: Response) => {
  try {
    const { workspaceId, title, data } = req.body || {};
    const { rows } = await pool.query('INSERT INTO templates (workspace_id, title, data) VALUES ($1,$2,$3) RETURNING id', [workspaceId, title || null, data || {}]);
    res.json({ id: rows[0].id });
  } catch (e: any) { res.status(500).json({ error: String(e) }); }
});

app.get('/v1/templates', async (req: Request, res: Response) => {
  try {
    const workspaceId = String(req.query.workspaceId || '');
    const { rows } = await pool.query('SELECT * FROM templates WHERE workspace_id=$1 ORDER BY created_at DESC', [workspaceId]);
    res.json({ items: rows });
  } catch (e: any) { res.status(500).json({ error: String(e) }); }
});

// Sources list
app.get('/v1/sources', async (req: Request, res: Response) => {
  try {
    const workspaceId = String(req.query.workspaceId || '');
    const { rows } = await pool.query('SELECT * FROM sources WHERE workspace_id=$1 ORDER BY created_at DESC', [workspaceId]);
    res.json({ items: rows });
  } catch (e: any) { res.status(500).json({ error: String(e) }); }
});

// AI canvas generator: outline/mindmap from prompt
const CanvasGenSchema = z.object({ workspaceId: z.string(), prompt: z.string(), model: z.string().default('openai/gpt-4o-mini') });
app.post('/v1/canvas/generate', async (req: Request, res: Response) => {
  const parse = CanvasGenSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { prompt, model } = parse.data;
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api';
  if (!apiKey) return res.status(500).json({ error: 'Missing OPENROUTER_API_KEY' });
  const sys = 'You are a canvas planner. Return a JSON with nodes and edges arrays to represent a mind map/outline for the user prompt. Node: {id,label,type}. Edge: {id,source,target}.';
  try {
    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [ { role: 'system', content: sys }, { role: 'user', content: prompt } ] })
    });
    const data: any = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? '{}';
    let json: any = {};
    try { json = JSON.parse(content); } catch { json = { nodes: [], edges: [] }; }
    res.status(resp.ok ? 200 : 500).json(json);
  } catch (e: any) { res.status(500).json({ error: String(e) }); }
});

app.post('/v1/chat/completions', async (req: Request, res: Response) => {
  const parse = OpenRouterSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }
  const { model, messages, stream } = parse.data;

  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api';
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing OPENROUTER_API_KEY' });
  }

  const url = `${baseUrl}/v1/chat/completions`;
  try {
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'http://localhost',
          'X-Title': 'ag-ui dev'
        },
        body: JSON.stringify({ model, messages, stream: true })
      });

      if (!resp.ok || !resp.body) {
        const text = await resp.text();
        res.status(500).end(text);
        return;
      }

      resp.body.on('data', (chunk: Buffer) => {
        res.write(chunk);
      });
      resp.body.on('end', () => res.end());
      resp.body.on('error', (err: any) => {
        res.write(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`);
        res.end();
      });
      req.on('close', () => resp.body?.destroy());
      return;
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'ag-ui dev'
      },
      body: JSON.stringify({ model, messages })
    });

    const data = await resp.json();
    return res.status(resp.ok ? 200 : 500).json(data);
  } catch (err: any) {
    return res.status(500).json({ error: String(err) });
  }
});

const upload = multer({ storage: multer.memoryStorage() });

app.post('/v1/files/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const workspaceId = String(req.query.workspaceId || '00000000-0000-0000-0000-000000000000');
    const file = (req as any).file as { originalname: string; buffer: Buffer; mimetype: string } | undefined;
    if (!file) return res.status(400).json({ error: 'No file' });
    const bucket = process.env.S3_BUCKET || 'ag-bucket';
    await ensureBucket(bucket);
    const objectName = `${workspaceId}/${Date.now()}_${file.originalname}`;
    await s3.putObject(bucket, objectName, file.buffer, file.mimetype);
    const { rows } = await pool.query(
      'INSERT INTO sources (workspace_id, kind, filename, mime, meta) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [workspaceId, 'file', file.originalname, file.mimetype, { objectName }]
    );
    return res.json({ id: rows[0].id, objectName });
  } catch (e: any) {
    return res.status(500).json({ error: String(e) });
  }
});

// Threads CRUD
app.post('/v1/threads', async (req: Request, res: Response) => {
  try {
    const { workspaceId, canvasId, title } = req.body || {};
    const { rows } = await pool.query(
      'INSERT INTO threads (workspace_id, canvas_id, title) VALUES ($1,$2,$3) RETURNING id',
      [workspaceId, canvasId || null, title || null]
    );
    res.json({ id: rows[0].id });
  } catch (e: any) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/v1/threads', async (req: Request, res: Response) => {
  try {
    const workspaceId = String(req.query.workspaceId || '');
    const { rows } = await pool.query('SELECT * FROM threads WHERE workspace_id = $1 ORDER BY created_at DESC', [workspaceId]);
    res.json({ items: rows });
  } catch (e: any) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/v1/threads/:id/messages', async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query('SELECT role, content, created_at FROM messages WHERE thread_id=$1 ORDER BY created_at ASC', [req.params.id]);
    res.json({ items: rows });
  } catch (e: any) { res.status(500).json({ error: String(e) }); }
});

// Chat within a thread (stores messages)
const ThreadChatSchema = z.object({ threadId: z.string(), model: z.string().default('openai/gpt-4o-mini'), messages: z.array(z.object({ role: z.enum(['system','user','assistant']), content: z.string() })) });
app.post('/v1/threads/:id/chat', async (req: Request, res: Response) => {
  const parse = ThreadChatSchema.safeParse({ ...req.body, threadId: req.params.id });
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { threadId, model, messages } = parse.data;
  try {
    // persist messages
    for (const m of messages) {
      await pool.query('INSERT INTO messages (thread_id, role, content) VALUES ($1,$2,$3)', [threadId, m.role, m.content]);
    }
    const apiKey = process.env.OPENROUTER_API_KEY;
    const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api';
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENROUTER_API_KEY' });
    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages })
    });
    const data: any = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    if (content) await pool.query('INSERT INTO messages (thread_id, role, content) VALUES ($1,$2,$3)', [threadId, 'assistant', content]);
    res.status(resp.ok ? 200 : 500).json(data);
  } catch (e: any) {
    res.status(500).json({ error: String(e) });
  }
});

// URL ingestion: fetch text and queue embedding
const UrlIngestSchema = z.object({ workspaceId: z.string(), url: z.string().url() });
app.post('/v1/ingest/url', async (req: Request, res: Response) => {
  const parse = UrlIngestSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { workspaceId, url } = parse.data;
  try {
    const r = await fetch(url);
    const text = await r.text();
    const { rows } = await pool.query('INSERT INTO sources (workspace_id, kind, url, meta) VALUES ($1,$2,$3,$4) RETURNING id', [workspaceId, 'url', url, {}]);
    // naive immediate ingest; in prod, push to queue
    req.body = { workspaceId, sourceId: rows[0].id, text };
    // reuse text ingestion
    // @ts-ignore
    return (app._router.handle as any)({ ...req, url: '/v1/ingest/text', method: 'POST' }, res, () => {});
  } catch (e: any) {
    return res.status(500).json({ error: String(e) });
  }
});

// Models list proxy
app.get('/v1/models', async (_req: Request, res: Response) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api';
  if (!apiKey) return res.status(500).json({ error: 'Missing OPENROUTER_API_KEY' });
  try {
    const resp = await fetch(`${baseUrl}/v1/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const data = await resp.json();
    return res.status(resp.ok ? 200 : 500).json(data);
  } catch (e: any) {
    return res.status(500).json({ error: String(e) });
  }
});

// Embeddings helper
async function embedTexts(texts: string[], model = 'openai/text-embedding-3-small'): Promise<number[][]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api';
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY');
  const resp = await fetch(`${baseUrl}/v1/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, input: texts })
  });
  if (!resp.ok) {
    const msg = await resp.text();
    throw new Error(`Embeddings error: ${msg}`);
  }
  const json: any = await resp.json();
  return json.data.map((d: any) => d.embedding as number[]);
}

// Ingest raw text into chunks with embeddings
const IngestTextSchema = z.object({
  workspaceId: z.string(),
  sourceId: z.string().optional(),
  text: z.string(),
  chunkSize: z.number().int().min(200).max(4000).default(1000),
  overlap: z.number().int().min(0).max(400).default(100),
  metadata: z.record(z.any()).optional()
});

app.post('/v1/ingest/text', async (req: Request, res: Response) => {
  const parse = IngestTextSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { workspaceId, sourceId, text, chunkSize, overlap, metadata } = parse.data;
  try {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += (chunkSize - overlap)) {
      chunks.push(text.slice(i, i + chunkSize));
    }
    const vectors = await embedTexts(chunks);
    const insertedIds: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const vecSql = toSql(vectors[i]);
      const { rows } = await pool.query(
        `INSERT INTO chunks (source_id, workspace_id, content, metadata, embedding)
         VALUES ($1, $2, $3, $4, ${vecSql}) RETURNING id`,
        [sourceId || null, workspaceId, chunks[i], metadata || {}]
      );
      insertedIds.push(rows[0].id);
    }
    return res.json({ count: insertedIds.length, ids: insertedIds });
  } catch (e: any) {
    return res.status(500).json({ error: String(e) });
  }
});

// Semantic search
const SearchSchema = z.object({ workspaceId: z.string(), query: z.string(), k: z.number().int().min(1).max(50).default(5) });
app.post('/v1/search', async (req: Request, res: Response) => {
  const parse = SearchSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { workspaceId, query, k } = parse.data;
  try {
    const [vec] = await embedTexts([query]);
    const { rows } = await pool.query(
      `SELECT id, content, metadata, (embedding <=> ${toSql(vec)}) AS distance
       FROM chunks WHERE workspace_id = $1
       ORDER BY embedding <=> ${toSql(vec)} ASC LIMIT $2`,
      [workspaceId, k]
    );
    return res.json({ results: rows });
  } catch (e: any) {
    return res.status(500).json({ error: String(e) });
  }
});

// Journeys executor using LangGraph
const JourneySchema = z.object({
  workspaceId: z.string(),
  steps: z.array(z.object({
    kind: z.enum(['search','summarize','write']),
    input: z.any().optional()
  }))
});
app.post('/v1/journeys/run', async (req: Request, res: Response) => {
  const parse = JourneySchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { workspaceId, steps } = parse.data;
  try {
    const { buildJourneyGraph } = require('./agents/journeys');
    const appGraph = buildJourneyGraph(steps);
    const result = await appGraph.invoke({ workspaceId });
    res.json({ state: result });
  } catch (e: any) { res.status(500).json({ error: String(e) }); }
});

app.get('/health', (_req: Request, res: Response) => res.json({ ok: true }));

const port = Number(process.env.PORT || 3001);
initDb()
  .then(() => {
    console.log('DB ready');
  })
  .catch((e: unknown) => {
    const msg = typeof e === 'object' && e && 'message' in e ? (e as any).message : String(e);
    console.warn('DB unreachable, starting API without DB features:', msg);
  })
  .finally(() => {
    app.listen(port, () => {
      console.log(`API listening on :${port}`);
    });
  });

