export interface User {
  id: string;
  username: string;
  email?: string;
  role: 'user' | 'admin';
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
  dailyUsedTokens: number;
  monthlyUsedTokens: number;
  lastTokenReset?: string;
  createdAt?: string;
  lastLogin?: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface Chat {
  id: string;
  title: string;
  model_name: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  last_message?: string;
}

export interface Message {
  id: string;
  chat_id: string;
  sender: 'user' | 'ai';
  content: string;
  tokens_used?: number;
  model_name?: string;
  attachments?: Attachment[];
  created_at: string;
  isStreaming?: boolean;
}

export interface Attachment {
  filename: string;
  originalName: string;
  url: string;
  mimetype: string;
  size: number;
}

export interface TokenInfo {
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
  dailyUsedTokens: number;
  monthlyUsedTokens: number;
  dailyRemaining: number;
  monthlyRemaining: number;
  nextReset: string;
  nextResetIn: string;
}

export interface AIModel {
  model_name: string;
  display_name: string;
  description: string;
  is_enabled: boolean;
}

export interface AdminDashboard {
  totalUsers: number;
  activeUsers: number;
  totalRequests: number;
  tokensToday: number;
  modelUsage: { model_name: string; requests: number; tokens: number }[];
  recentActivity: any[];
}
