import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { WorkspaceService } from '../../services/workspace.service';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="toolbar">
      <button (click)="ai('summarize')">Summarize</button>
      <button (click)="ai('rewrite')">Rewrite</button>
      <button (click)="exportMd()">Export MD</button>
      <button (click)="exportHtml()">Export HTML</button>
    </div>
    <div class="editor-layout">
      <div class="left">
        <input [(ngModel)]="query" placeholder="Search knowledge..."/>
        <button (click)="search()">Search</button>
        <div class="results">
          <div *ngFor="let r of results()" class="result">
            {{ r.content }}
            <button (click)="insertCitation(r)">Insert cite</button>
          </div>
        </div>
      </div>
      <textarea class="right" [(ngModel)]="text" rows="20" style="width:100%"></textarea>
    </div>
  `
})
export class EditorComponent {
  private http = inject(HttpClient);
  private ws = inject(WorkspaceService);
  text = '';
  query = '';
  results = signal<any[]>([]);

  async ai(kind: 'summarize'|'rewrite') {
    const prompt = kind === 'summarize' ? `Summarize the following text:\n\n${this.text}` : `Rewrite to improve clarity and style. Keep meaning.\n\n${this.text}`;
    const body = { model: 'openai/gpt-4o-mini', messages: [ { role: 'user', content: prompt } ] };
    const r: any = await this.http.post('/api/v1/chat/completions', body).toPromise();
    const content = r?.choices?.[0]?.message?.content ?? '';
    if (content) this.text = content;
  }

  exportMd() {
    const blob = new Blob([this.text], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'document.md';
    a.click();
  }

  exportHtml() {
    const html = `<html><body><pre>${this.escapeHtml(this.text)}</pre></body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'document.html';
    a.click();
  }

  private escapeHtml(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async search() {
    if (!this.query.trim()) return;
    const r: any = await this.http.post('/api/v1/search', { workspaceId: this.ws.currentWorkspaceId(), query: this.query, k: 5 }).toPromise();
    this.results.set(r?.results || []);
  }

  insertCitation(r: any) {
    const cite = ` [cite:${r.id}]`;
    this.text += cite;
  }
}

