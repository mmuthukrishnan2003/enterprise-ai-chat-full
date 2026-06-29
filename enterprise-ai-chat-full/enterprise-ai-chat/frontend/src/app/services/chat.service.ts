import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { environment } from '../../environments/environment';
import { Chat, Message, TokenInfo } from '../models';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class ChatService {
  private apiUrl = environment.apiUrl;
  private eventSource: EventSource | null = null;

  streamChunk$ = new Subject<string>();
  streamDone$ = new Subject<{ messageId: string; tokensUsed: number; dailyRemaining: number; monthlyRemaining: number }>();
  streamError$ = new Subject<string>();
  chatIdReceived$ = new Subject<string>();

  constructor(private http: HttpClient, private authService: AuthService) {}

  getChats(page = 1, limit = 20): Observable<{ chats: Chat[]; total: number }> {
    return this.http.get<any>(`${this.apiUrl}/chat`, { params: { page, limit } });
  }

  getMessages(chatId: string, page = 1): Observable<{ chat: Chat; messages: Message[]; total: number }> {
    return this.http.get<any>(`${this.apiUrl}/chat/${chatId}/messages`, { params: { page, limit: 50 } });
  }

  createChat(title?: string, model?: string): Observable<Chat> {
    return this.http.post<Chat>(`${this.apiUrl}/chat/new`, { title, model });
  }

  updateChat(chatId: string, updates: Partial<Chat>): Observable<Chat> {
    return this.http.patch<Chat>(`${this.apiUrl}/chat/${chatId}`, updates);
  }

  deleteChat(chatId: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/chat/${chatId}`);
  }

  searchChats(q: string): Observable<Chat[]> {
    return this.http.get<Chat[]>(`${this.apiUrl}/chat/search`, { params: { q } });
  }

  getTokenInfo(): Observable<TokenInfo> {
    return this.http.get<TokenInfo>(`${this.apiUrl}/chat/token-info`);
  }

  getModels(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/models`);
  }

  uploadFile(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post(`${this.apiUrl}/upload`, formData);
  }

  sendMessageStream(chatId: string | null, message: string, model: string): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    const token = this.authService.accessToken;
    const body = { chatId, message, model };

    fetch(`${this.apiUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }).then(response => {
      if (!response.ok) {
        response.json().then(err => this.streamError$.next(err.error || 'Request failed'));
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processChunk = ({ done, value }: ReadableStreamReadResult<Uint8Array>): Promise<void> => {
        if (done) return Promise.resolve();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'chat_id') this.chatIdReceived$.next(data.chatId);
              else if (data.type === 'chunk') this.streamChunk$.next(data.content);
              else if (data.type === 'done') this.streamDone$.next(data);
              else if (data.type === 'error') this.streamError$.next(data.error);
            } catch {}
          }
        }
        return reader.read().then(processChunk);
      };

      reader.read().then(processChunk);
    }).catch(err => {
      this.streamError$.next(err.message || 'Connection error');
    });
  }

  stopStream(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}
