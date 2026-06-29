import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { ChatService } from '../../services/chat.service';
import { AuthService } from '../../services/auth.service';
import { Chat, Message, TokenInfo, AIModel, User } from '../../models';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss'],
})
export class ChatComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('messagesContainer') messagesContainer!: ElementRef;
  @ViewChild('messageInput') messageInput!: ElementRef;
  @ViewChild('fileInput') fileInput!: ElementRef;

  currentUser: User | null = null;
  chats: Chat[] = [];
  messages: Message[] = [];
  currentChatId: string | null = null;
  currentChat: Chat | null = null;

  inputMessage = '';
  isStreaming = false;
  streamingMessage = '';
  isLoadingChats = false;
  isLoadingMessages = false;
  sidebarOpen = true;
  darkMode = false;
  searchQuery = '';
  filteredChats: Chat[] = [];

  tokenInfo: TokenInfo | null = null;
  models: AIModel[] = [];
  selectedModel = 'qwen3';

  editingChatId: string | null = null;
  editingTitle = '';

  uploadedFile: any = null;
  isUploading = false;

  private subs = new Subscription();
  private shouldScrollBottom = false;
  private searchSubject = new Subject<string>();

  constructor(
    private chatService: ChatService,
    private authService: AuthService,
    private route: ActivatedRoute,
    private router: Router,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.currentUser = this.authService.currentUser;
    this.darkMode = localStorage.getItem('darkMode') === 'true';
    this.applyTheme();

    this.loadChats();
    this.loadTokenInfo();
    this.loadModels();

    this.subs.add(this.route.params.subscribe(params => {
      if (params['chatId'] && params['chatId'] !== this.currentChatId) {
        this.selectChat(params['chatId']);
      }
    }));

    this.subs.add(this.chatService.streamChunk$.subscribe(chunk => {
      this.streamingMessage += chunk;
      this.shouldScrollBottom = true;
      this.cdr.detectChanges();
    }));

    this.subs.add(this.chatService.streamDone$.subscribe(data => {
      const streamingMsg: Message = {
        id: data.messageId,
        chat_id: this.currentChatId!,
        sender: 'ai',
        content: this.streamingMessage,
        tokens_used: data.tokensUsed,
        model_name: this.selectedModel,
        created_at: new Date().toISOString(),
      };
      this.messages.push(streamingMsg);
      this.streamingMessage = '';
      this.isStreaming = false;

      if (this.tokenInfo) {
        this.tokenInfo.dailyRemaining = data.dailyRemaining;
        this.tokenInfo.monthlyRemaining = data.monthlyRemaining;
      }
      this.shouldScrollBottom = true;
      this.cdr.detectChanges();
      this.loadChats();
    }));

    this.subs.add(this.chatService.streamError$.subscribe(err => {
      this.isStreaming = false;
      this.streamingMessage = '';
      alert('Error: ' + err);
      this.cdr.detectChanges();
    }));

    this.subs.add(this.chatService.chatIdReceived$.subscribe(chatId => {
      this.currentChatId = chatId;
      this.router.navigate(['/chat', chatId], { replaceUrl: true });
    }));

    this.subs.add(this.searchSubject.pipe(debounceTime(300), distinctUntilChanged()).subscribe(q => {
      if (q.trim()) {
        this.chatService.searchChats(q).subscribe(chats => { this.filteredChats = chats; });
      } else {
        this.filteredChats = this.chats;
      }
    }));
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollBottom) {
      this.scrollToBottom();
      this.shouldScrollBottom = false;
    }
  }

  ngOnDestroy(): void { this.subs.unsubscribe(); }

  loadChats(): void {
    this.isLoadingChats = true;
    this.chatService.getChats().subscribe({
      next: (res) => {
        this.chats = res.chats;
        this.filteredChats = this.chats;
        this.isLoadingChats = false;
        this.cdr.detectChanges();
      },
      error: () => { this.isLoadingChats = false; }
    });
  }

  loadTokenInfo(): void {
    this.chatService.getTokenInfo().subscribe(info => {
      this.tokenInfo = info;
      this.cdr.detectChanges();
    });
  }

  loadModels(): void {
    this.chatService.getModels().subscribe(models => { this.models = models; });
  }

  selectChat(chatId: string): void {
    if (this.isStreaming) return;
    this.currentChatId = chatId;
    this.messages = [];
    this.streamingMessage = '';
    this.isLoadingMessages = true;

    this.chatService.getMessages(chatId).subscribe({
      next: (res) => {
        this.currentChat = res.chat;
        this.messages = res.messages;
        this.isLoadingMessages = false;
        this.shouldScrollBottom = true;
        this.cdr.detectChanges();
      },
      error: () => { this.isLoadingMessages = false; }
    });
  }

  newChat(): void {
    this.currentChatId = null;
    this.currentChat = null;
    this.messages = [];
    this.streamingMessage = '';
    this.router.navigate(['/chat']);
  }

  sendMessage(): void {
    const msg = this.inputMessage.trim();
    if (!msg || this.isStreaming) return;
    if (this.tokenInfo && this.tokenInfo.dailyRemaining <= 0) {
      alert('Daily token limit exceeded. Please wait for reset.');
      return;
    }

    const userMsg: Message = {
      id: 'temp-' + Date.now(),
      chat_id: this.currentChatId || '',
      sender: 'user',
      content: msg,
      created_at: new Date().toISOString(),
    };
    this.messages.push(userMsg);
    this.inputMessage = '';
    this.isStreaming = true;
    this.streamingMessage = '';
    this.shouldScrollBottom = true;
    this.cdr.detectChanges();

    this.chatService.sendMessageStream(this.currentChatId, msg, this.selectedModel);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  deleteChat(chatId: string, event: Event): void {
    event.stopPropagation();
    if (!confirm('Delete this chat?')) return;
    this.chatService.deleteChat(chatId).subscribe(() => {
      this.chats = this.chats.filter(c => c.id !== chatId);
      this.filteredChats = this.filteredChats.filter(c => c.id !== chatId);
      if (this.currentChatId === chatId) this.newChat();
    });
  }

  startRename(chat: Chat, event: Event): void {
    event.stopPropagation();
    this.editingChatId = chat.id;
    this.editingTitle = chat.title;
  }

  saveRename(chatId: string): void {
    if (!this.editingTitle.trim()) return;
    this.chatService.updateChat(chatId, { title: this.editingTitle }).subscribe(updated => {
      const idx = this.chats.findIndex(c => c.id === chatId);
      if (idx > -1) this.chats[idx].title = updated.title;
      this.filteredChats = [...this.chats];
      if (this.currentChat?.id === chatId) this.currentChat.title = updated.title;
      this.editingChatId = null;
    });
  }

  onSearchChange(q: string): void { this.searchSubject.next(q); }

  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.isUploading = true;
    this.chatService.uploadFile(file).subscribe({
      next: (res) => { this.uploadedFile = res; this.isUploading = false; },
      error: () => { this.isUploading = false; alert('Upload failed'); }
    });
  }

  toggleTheme(): void {
    this.darkMode = !this.darkMode;
    localStorage.setItem('darkMode', String(this.darkMode));
    this.applyTheme();
  }

  applyTheme(): void {
    document.documentElement.classList.toggle('dark', this.darkMode);
  }

  logout(): void { this.authService.logout(); }

  copyMessage(content: string): void {
    navigator.clipboard.writeText(content).then(() => { /* optional toast */ });
  }

  private scrollToBottom(): void {
    try {
      this.messagesContainer.nativeElement.scrollTop = this.messagesContainer.nativeElement.scrollHeight;
    } catch {}
  }

  renderMarkdown(content: string): SafeHtml {
    // Simple markdown renderer
    let html = content
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/^\- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
    return this.sanitizer.bypassSecurityTrustHtml('<p>' + html + '</p>');
  }

  getTokenPercentage(used: number, total: number): number {
    return Math.min(100, Math.round((used / total) * 100));
  }
}
