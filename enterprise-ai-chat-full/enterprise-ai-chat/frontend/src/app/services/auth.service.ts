import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap, catchError, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';
import { AuthResponse, User } from '../models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private apiUrl = environment.apiUrl;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  currentUser$ = this.currentUserSubject.asObservable();

  constructor(private http: HttpClient, private router: Router) {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    const token = localStorage.getItem('accessToken');
    const user = localStorage.getItem('currentUser');
    if (token && user) {
      try {
        this.currentUserSubject.next(JSON.parse(user));
      } catch { this.clearStorage(); }
    }
  }

  get currentUser(): User | null { return this.currentUserSubject.value; }
  get accessToken(): string | null { return localStorage.getItem('accessToken'); }
  get isLoggedIn(): boolean { return !!this.accessToken && !!this.currentUser; }
  get isAdmin(): boolean { return this.currentUser?.role === 'admin'; }

  login(username: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/auth/login`, { username, password }).pipe(
      tap(res => this.handleAuthSuccess(res)),
      catchError(err => throwError(() => err))
    );
  }

  signup(username: string, password: string, email?: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/auth/signup`, { username, password, email }).pipe(
      tap(res => this.handleAuthSuccess(res))
    );
  }

  refreshToken(): Observable<any> {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) return throwError(() => new Error('No refresh token'));
    return this.http.post<any>(`${this.apiUrl}/auth/refresh-token`, { refreshToken }).pipe(
      tap(res => {
        localStorage.setItem('accessToken', res.accessToken);
        localStorage.setItem('refreshToken', res.refreshToken);
      }),
      catchError(err => {
        this.logout();
        return throwError(() => err);
      })
    );
  }

  logout(): void {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      this.http.post(`${this.apiUrl}/auth/logout`, { refreshToken }).subscribe();
    }
    this.clearStorage();
    this.currentUserSubject.next(null);
    this.router.navigate(['/login']);
  }

  updateCurrentUser(updates: Partial<User>): void {
    const user = { ...this.currentUser, ...updates } as User;
    this.currentUserSubject.next(user);
    localStorage.setItem('currentUser', JSON.stringify(user));
  }

  private handleAuthSuccess(res: AuthResponse): void {
    localStorage.setItem('accessToken', res.accessToken);
    localStorage.setItem('refreshToken', res.refreshToken);
    localStorage.setItem('currentUser', JSON.stringify(res.user));
    this.currentUserSubject.next(res.user);
  }

  private clearStorage(): void {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('currentUser');
  }
}
