import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  currentWorkspaceId = signal<string>('00000000-0000-0000-0000-000000000000');
  workspaces = signal<any[]>([]);

  constructor(private http: HttpClient) {
    this.refresh();
  }

  async refresh() {
    const r: any = await this.http.get('/api/v1/workspaces').toPromise();
    this.workspaces.set(r?.items || []);
    if (!this.workspaces().length) {
      const w: any = await this.http.post('/api/v1/workspaces', { name: 'Default' }).toPromise();
      this.currentWorkspaceId.set(w?.id || this.currentWorkspaceId());
    } else if (this.currentWorkspaceId() === '00000000-0000-0000-0000-000000000000') {
      this.currentWorkspaceId.set(this.workspaces()[0].id);
    }
  }
}

