import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../services/auth.service';
import { AdminDashboard, User } from '../../models';

@Component({
  selector: 'app-admin',
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.scss'],
})
export class AdminComponent implements OnInit {
  activeTab = 'dashboard';
  dashboard: AdminDashboard | null = null;
  users: User[] = [];
  totalUsers = 0;
  models: any[] = [];
  analytics: any = null;
  logs: any[] = [];
  isLoading = false;
  searchUser = '';
  darkMode = false;

  newUserForm = { username: '', email: '', password: '', role: 'user', dailyTokenLimit: 10000, monthlyTokenLimit: 300000 };
  showNewUserForm = false;
  formError = '';

  editUser: User | null = null;

  constructor(
    private http: HttpClient,
    private router: Router,
    public authService: AuthService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.darkMode = localStorage.getItem('darkMode') === 'true';
    document.documentElement.classList.toggle('dark', this.darkMode);
    this.loadDashboard();
  }

  private api(path: string) { return `${environment.apiUrl}${path}`; }

  loadDashboard(): void {
    this.isLoading = true;
    this.http.get<AdminDashboard>(this.api('/admin/dashboard')).subscribe({
      next: (data) => { this.dashboard = data; this.isLoading = false; this.cdr.detectChanges(); },
      error: () => { this.isLoading = false; }
    });
  }

  loadUsers(): void {
    this.isLoading = true;
    this.http.get<any>(this.api(`/admin/users?search=${this.searchUser}`)).subscribe({
      next: (res) => { this.users = res.users; this.totalUsers = res.total; this.isLoading = false; this.cdr.detectChanges(); },
      error: () => { this.isLoading = false; }
    });
  }

  loadModels(): void {
    this.http.get<any[]>(this.api('/admin/models')).subscribe(models => { this.models = models; this.cdr.detectChanges(); });
  }

  loadAnalytics(): void {
    this.http.get<any>(this.api('/admin/analytics?days=7')).subscribe(data => { this.analytics = data; this.cdr.detectChanges(); });
  }

  loadLogs(): void {
    this.http.get<any>(this.api('/admin/logs')).subscribe(res => { this.logs = res.logs; this.cdr.detectChanges(); });
  }

  selectTab(tab: string): void {
    this.activeTab = tab;
    if (tab === 'users') this.loadUsers();
    else if (tab === 'models') this.loadModels();
    else if (tab === 'analytics') this.loadAnalytics();
    else if (tab === 'logs') this.loadLogs();
    else this.loadDashboard();
  }

  createUser(): void {
    this.formError = '';
    if (!this.newUserForm.username || !this.newUserForm.password) {
      this.formError = 'Username and password required';
      return;
    }
    this.http.post(this.api('/admin/users'), this.newUserForm).subscribe({
      next: () => {
        this.showNewUserForm = false;
        this.newUserForm = { username: '', email: '', password: '', role: 'user', dailyTokenLimit: 10000, monthlyTokenLimit: 300000 };
        this.loadUsers();
      },
      error: (err) => { this.formError = err.error?.error || 'Failed to create user'; }
    });
  }

  suspendUser(user: User): void {
    const action = user.is_suspended ? 'unsuspend' : 'suspend';
    if (!confirm(`${action} ${user.username}?`)) return;
    this.http.patch(this.api(`/admin/users/${user.id}`), { is_suspended: !user.is_suspended }).subscribe(() => this.loadUsers());
  }

  deleteUser(userId: string, username: string): void {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    this.http.delete(this.api(`/admin/users/${userId}`)).subscribe(() => this.loadUsers());
  }

  resetTokens(userId: string, type: string): void {
    this.http.post(this.api(`/admin/users/${userId}/reset-tokens`), { type }).subscribe(() => this.loadUsers());
  }

  resetPassword(userId: string): void {
    const pw = prompt('Enter new password (min 6 chars):');
    if (!pw || pw.length < 6) return;
    this.http.post(this.api(`/admin/users/${userId}/reset-password`), { newPassword: pw }).subscribe({
      next: () => alert('Password reset successfully'),
      error: () => alert('Failed to reset password'),
    });
  }

  toggleModel(model: any): void {
    this.http.patch(this.api(`/admin/models/${model.model_name}`), { is_enabled: !model.is_enabled })
      .subscribe(() => this.loadModels());
  }

  pullModel(modelName: string): void {
    if (!confirm(`Pull "${modelName}" from Ollama? This may take several minutes.`)) return;
    fetch(`${environment.apiUrl}/admin/models/${modelName}/pull`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.authService.accessToken}` },
    }).then(res => {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const read = (): Promise<void> => reader.read().then(({ done, value }) => {
        if (done) { this.loadModels(); return; }
        const text = decoder.decode(value);
        console.log('Pull status:', text);
        return read();
      });
      return read();
    });
  }

  logout(): void { this.authService.logout(); }
  goToChat(): void { this.router.navigate(['/chat']); }
  toggleTheme(): void {
    this.darkMode = !this.darkMode;
    localStorage.setItem('darkMode', String(this.darkMode));
    document.documentElement.classList.toggle('dark', this.darkMode);
  }
}
