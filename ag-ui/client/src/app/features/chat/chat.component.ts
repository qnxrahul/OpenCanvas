import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { WorkspaceService } from '../../services/workspace.service';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="chat">
      <div class="sidebar">
        <label>Workspace:
          <select [ngModel]="workspaceId" (ngModelChange)="ws.currentWorkspaceId.set($event)">
            <option *ngFor="let w of ws.workspaces()" [value]="w.id">{{ w.name }}</option>
          </select>
        </label>
        <button (click)="newThread()">New Thread</button>
        <div *ngFor="let t of threads()" class="thread" (click)="selectThread(t.id)" [class.active]="t.id===threadId">{{ t.title || t.id }}</div>
      </div>
      <div class="messages">
        <div *ngFor="let m of messages()" class="message" [class.user]="m.role==='user'" [class.assistant]="m.role==='assistant'">
          <strong>{{ m.role }}:</strong> <span>{{ m.content }}</span>
        </div>
      </div>
      <form (ngSubmit)="send()" class="composer">
        <div class="context-chips">
          <span *ngFor="let c of contextChips()" class="chip">{{ c }}</span>
        </div>
        <textarea [(ngModel)]="input" name="input" rows="3" placeholder="Ask something..." required></textarea>
        <button type="submit" [disabled]="pending()">Send</button>
      </form>
    </div>
  `,
  styles: [`
    .chat { display: grid; grid-template-columns: 240px 1fr; height: 100vh; gap: 0; }
    .sidebar { border-right: 1px solid #eee; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
    .thread { padding: 6px; border-radius: 4px; cursor: pointer; }
    .thread.active { background: #eef2ff; }
    .messages { overflow: auto; display: flex; flex-direction: column; gap: 8px; padding: 12px; }
    .message { padding: 8px 10px; border-radius: 8px; background: #f3f4f6; }
    .message.user { background: #e0f2fe; align-self: flex-end; }
    .message.assistant { background: #f3f4f6; align-self: flex-start; }
    .composer { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-top: 1px solid #eee; }
    textarea { width: 100%; resize: vertical; }
    button { align-self: flex-end; }
    .context-chips { display: flex; gap: 6px; flex-wrap: wrap; }
    .chip { background: #f1f5f9; padding: 2px 6px; border-radius: 12px; font-size: 12px; }
  `]
})
export class ChatComponent {
  private http = inject(HttpClient);
  ws = inject(WorkspaceService);
  input = '';
  messages = signal<ChatMessage[]>([]);
  pending = signal(false);
  get workspaceId() { return this.ws.currentWorkspaceId(); }
  threadId: string | null = null;
  threads = signal<any[]>([]);
  contextChips = signal<string[]>(['current canvas', 'top results']);

  async send() {
    const text = this.input.trim();
    if (!text) return;
    this.input = '';
    this.messages.update((arr) => arr.concat({ role: 'user', content: text }));
    this.pending.set(true);
    try {
      if (!this.threadId) {
        const t: any = await this.http.post('/api/v1/threads', { workspaceId: this.workspaceId, title: 'New thread' }).toPromise();
        this.threadId = t?.id || null;
      }
      const body = { model: 'openai/gpt-4o-mini', messages: this.messages().map(m => ({ role: m.role, content: m.content })) };
      const resp: any = await this.http.post(`/api/v1/threads/${this.threadId}/chat`, body).toPromise();
      const content = resp?.choices?.[0]?.message?.content ?? '[no response]';
      this.messages.update((arr) => arr.concat({ role: 'assistant', content }));
    } catch (e: any) {
      this.messages.update((arr) => arr.concat({ role: 'assistant', content: 'Error: ' + String(e?.message || e) }));
    } finally {
      this.pending.set(false);
    }
  }

  async newThread() {
    const t: any = await this.http.post('/api/v1/threads', { workspaceId: this.workspaceId, title: 'New thread' }).toPromise();
    this.threadId = t?.id || null;
    this.messages.set([]);
    await this.refreshThreads();
  }

  async selectThread(id: string) {
    this.threadId = id;
    const r: any = await this.http.get(`/api/v1/threads/${id}/messages`).toPromise();
    this.messages.set((r?.items || []).map((m: any) => ({ role: m.role, content: m.content })));
  }

  async refreshThreads() {
    const r: any = await this.http.get(`/api/v1/threads?workspaceId=${this.workspaceId}`).toPromise();
    this.threads.set(r?.items || []);
  }

  constructor() {
    this.refreshThreads();
  }
}

