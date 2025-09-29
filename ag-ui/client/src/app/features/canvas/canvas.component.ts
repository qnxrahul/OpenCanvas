import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { WorkspaceService } from '../../services/workspace.service';

type Node = { id: string; label: string; type?: string; x?: number; y?: number };
type Edge = { id: string; source: string; target: string };

@Component({
  selector: 'app-canvas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="toolbar">
      <label>Workspace:
        <select [ngModel]="workspaceId" (ngModelChange)="ws.currentWorkspaceId.set($event)">
          <option *ngFor="let w of ws.workspaces()" [value]="w.id">{{ w.name }}</option>
        </select>
      </label>
      <input [(ngModel)]="prompt" placeholder="Describe your canvas..." />
      <button (click)="generate()">AI Generate</button>
      <button (click)="save()" [disabled]="saving()">Save</button>
      <button (click)="loadTemplates()">Templates</button>
    </div>
    <div class="panel">
      <div class="left">
        <h4>Knowledge</h4>
        <input type="file" (change)="upload($event)" />
        <input [(ngModel)]="url" placeholder="https://..." />
        <button (click)="ingestUrl()">Add URL</button>
        <input [(ngModel)]="query" placeholder="Search knowledge..." />
        <button (click)="search()">Search</button>
        <div class="results">
          <div *ngFor="let r of searchResults()" class="result">
            {{ r.content }}
            <button (click)="copyCitation(r)">Copy citation</button>
          </div>
        </div>
      </div>
      <div class="right">
        <div class="canvas" (mousedown)="onMouseDown($event)" (mousemove)="onMouseMove($event)" (mouseup)="onMouseUp()">
          <svg class="edges" xmlns="http://www.w3.org/2000/svg">
            <line *ngFor="let e of edges()" [attr.x1]="nodeById(e.source)?.x || 20" [attr.y1]="(nodeById(e.source)?.y || 20) + 20" [attr.x2]="nodeById(e.target)?.x || 20" [attr.y2]="(nodeById(e.target)?.y || 20) + 20" stroke="#cbd5e1" stroke-width="2" />
          </svg>
          <div *ngFor="let n of nodes()" class="node" [style.left.px]="n.x || 20" [style.top.px]="n.y || 20" (mousedown)="pickNode(n, $event)">{{ n.label }}</div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .toolbar { display: flex; gap: 8px; padding: 8px; border-bottom: 1px solid #eee; }
    .panel { display: grid; grid-template-columns: 280px 1fr; height: calc(100vh - 48px); }
    .left { padding: 8px; border-right: 1px solid #eee; display: flex; flex-direction: column; gap: 8px; }
    .right { position: relative; }
    .canvas { position: relative; height: 100%; background: #fafafa; }
    svg.edges { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
    .node { position: absolute; background: #fff; border: 1px solid #ddd; padding: 6px 8px; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
    .results { display: flex; flex-direction: column; gap: 4px; max-height: 40vh; overflow: auto; }
    .result { background: #f8fafc; padding: 6px; border: 1px solid #e5e7eb; border-radius: 4px; }
  `]
})
export class CanvasComponent {
  private http = inject(HttpClient);
  private ws = inject(WorkspaceService);

  get workspaceId() { return this.ws.currentWorkspaceId(); }
  canvasId: string | null = null;
  title = 'Untitled';

  prompt = '';
  url = '';
  query = '';

  nodes = signal<Node[]>([]);
  edges = signal<Edge[]>([]);
  searchResults = signal<any[]>([]);
  saving = signal(false);

  private draggingId: string | null = null;
  private offsetX = 0;
  private offsetY = 0;

  nodeById(id: string | undefined) {
    if (!id) return undefined;
    return this.nodes().find(n => n.id === id);
  }

  pickNode(n: Node, evt: MouseEvent) {
    this.draggingId = n.id;
    const nx = n.x || 20, ny = n.y || 20;
    this.offsetX = evt.clientX - nx;
    this.offsetY = evt.clientY - ny;
    evt.stopPropagation();
  }

  onMouseDown(_evt: MouseEvent) {}
  onMouseMove(evt: MouseEvent) {
    if (!this.draggingId) return;
    const nx = evt.clientX - this.offsetX;
    const ny = evt.clientY - this.offsetY;
    this.nodes.update(arr => arr.map(n => n.id === this.draggingId ? { ...n, x: nx, y: ny } : n));
  }
  onMouseUp() { this.draggingId = null; }

  async generate() {
    if (!this.prompt.trim()) return;
    const resp: any = await this.http.post('/api/v1/canvas/generate', { workspaceId: this.workspaceId, prompt: this.prompt }).toPromise();
    this.nodes.set(resp?.nodes || []);
    this.edges.set(resp?.edges || []);
  }

  async save() {
    this.saving.set(true);
    const data = { nodes: this.nodes(), edges: this.edges() };
    if (!this.canvasId) {
      const r: any = await this.http.post('/api/v1/canvases', { workspaceId: this.workspaceId, title: this.title, data }).toPromise();
      this.canvasId = r?.id || null;
    } else {
      await this.http.put(`/api/v1/canvases/${this.canvasId}`, { title: this.title, data }).toPromise();
    }
    this.saving.set(false);
  }

  async upload(evt: Event) {
    const input = evt.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    await this.http.post(`/api/v1/files/upload?workspaceId=${this.workspaceId}`, form).toPromise();
  }

  async ingestUrl() {
    if (!this.url.trim()) return;
    await this.http.post('/api/v1/ingest/url', { workspaceId: this.workspaceId, url: this.url }).toPromise();
    this.url = '';
  }

  async search() {
    if (!this.query.trim()) return;
    const r: any = await this.http.post('/api/v1/search', { workspaceId: this.workspaceId, query: this.query, k: 5 }).toPromise();
    this.searchResults.set(r?.results || []);
  }

  copyCitation(r: any) {
    const text = `[cite:${r.id}] ${r.content.slice(0, 120)}...`;
    navigator.clipboard.writeText(text);
  }

  async loadTemplates() {
    await this.http.get(`/api/v1/templates?workspaceId=${this.workspaceId}`).toPromise();
    // Placeholder: could open a modal to select template and apply
  }
}

