// Minimal LangGraph journeys runner: executes steps with simple state passing.
import { StateGraph, END } from '@langchain/langgraph';

type JourneyState = {
  workspaceId: string;
  results?: any[];
  text?: string;
  draft?: string;
};

export function buildJourneyGraph(steps: { kind: 'search'|'summarize'|'write'; input?: any }[]) {
  const graph = new StateGraph<JourneyState>({ channels: {} });

  // Nodes
  graph.addNode('search', async (state, { request }) => {
    const query = String((request?.input?.query) || '');
    const res = await fetch(`http://localhost:${process.env.PORT || 3001}/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: state.workspaceId, query, k: 5 })
    });
    const json = await res.json();
    return { ...state, results: json?.results || [] };
  });

  graph.addNode('summarize', async (state, { request }) => {
    const text = String((request?.input?.text) || state.text || '');
    const body = { model: 'openai/gpt-4o-mini', messages: [ { role: 'user', content: 'Summarize this:\n\n' + text } ] };
    const resp = await fetch((process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api') + '/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}` }, body: JSON.stringify(body)
    });
    const data: any = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    return { ...state, text: content };
  });

  graph.addNode('write', async (state, { request }) => {
    const prompt = String((request?.input?.prompt) || 'Write a short draft.');
    const body = { model: 'openai/gpt-4o-mini', messages: [ { role: 'user', content: prompt } ] };
    const resp = await fetch((process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api') + '/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}` }, body: JSON.stringify(body)
    });
    const data: any = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    return { ...state, draft: content };
  });

  // Chain steps in sequence
  let last = 'start';
  graph.addEdge('start', steps.length ? 'step0' : END);
  steps.forEach((s, idx) => {
    const nodeName = `step${idx}`;
    // wrapper node selects which underlying node to call
    graph.addNode(nodeName, async (state) => {
      const inner = s.kind;
      const call = await (graph as any).nodes.get(inner).func(state, { request: { input: s.input } });
      return call as JourneyState;
    });
    if (idx < steps.length - 1) graph.addEdge(nodeName, `step${idx+1}`);
    else graph.addEdge(nodeName, END);
  });

  return graph.compile({ checkpointer: undefined });
}

