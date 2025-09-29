import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="chat">
      <div class="messages">
        <div *ngFor="let m of messages()" class="message" [class.user]="m.role==='user'" [class.assistant]="m.role==='assistant'">
          <strong>{{ m.role }}:</strong> <span>{{ m.content }}</span>
        </div>
      </div>
      <form (ngSubmit)="send()" class="composer">
        <textarea [(ngModel)]="input" name="input" rows="3" placeholder="Ask something..." required></textarea>
        <button type="submit" [disabled]="pending()">Send</button>
      </form>
    </div>
  `,
  styles: [`
    .chat { display: flex; flex-direction: column; height: 100vh; padding: 12px; gap: 12px; }
    .messages { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
    .message { padding: 8px 10px; border-radius: 8px; background: #f3f4f6; }
    .message.user { background: #e0f2fe; align-self: flex-end; }
    .message.assistant { background: #f3f4f6; align-self: flex-start; }
    .composer { display: flex; flex-direction: column; gap: 8px; }
    textarea { width: 100%; resize: vertical; }
    button { align-self: flex-end; }
  `]
})
export class ChatComponent {
  private http = inject(HttpClient);
  input = '';
  messages = signal<ChatMessage[]>([]);
  pending = signal(false);

  async send() {
    const text = this.input.trim();
    if (!text) return;
    this.input = '';
    this.messages.update((arr) => arr.concat({ role: 'user', content: text }));
    this.pending.set(true);
    try {
      const body = {
        model: 'openai/gpt-4o-mini',
        messages: this.messages().map(m => ({ role: m.role, content: m.content }))
      };
      const resp: any = await this.http.post('/api/v1/chat/completions', body).toPromise();
      const content = resp?.choices?.[0]?.message?.content ?? '[no response]';
      this.messages.update((arr) => arr.concat({ role: 'assistant', content }));
    } catch (e: any) {
      this.messages.update((arr) => arr.concat({ role: 'assistant', content: 'Error: ' + String(e?.message || e) }));
    } finally {
      this.pending.set(false);
    }
  }
}

