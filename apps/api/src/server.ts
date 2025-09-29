import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import fetch from 'node-fetch';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const OpenRouterSchema = z.object({
  model: z.string().default('openai/gpt-4o-mini'),
  messages: z.array(z.object({ role: z.enum(['system','user','assistant']), content: z.string() })),
  stream: z.boolean().optional()
});

app.post('/v1/chat/completions', async (req, res) => {
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

app.get('/health', (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`API listening on :${port}`);
});

