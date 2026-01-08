/**
 * HTTP Client for API Communication
 * 
 * Thin wrapper around undici for making requests to the API server.
 * Handles authentication, token refresh, and error handling.
 */

import { request } from 'undici';
import { 
  config, 
  getValidToken, 
  getRefreshToken, 
  saveTokens, 
  clearTokens 
} from '../config/index.js';

export interface ApiResponse<T = unknown> {
  success?: boolean;
  data?: T;
  error?: string;
  message?: string;
  statusCode?: number;
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
}

export class ApiClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor() {
    this.baseUrl = config.apiUrl;
    this.apiKey = config.apiKey;
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    // Prefer API key if available
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
      return headers;
    }
    
    // Try to get valid token
    let token = getValidToken();
    
    // If token expired, try to refresh
    if (!token) {
      const refreshToken = getRefreshToken();
      if (refreshToken) {
        try {
          const refreshed = await this.refreshAccessToken(refreshToken);
          if (refreshed) {
            token = refreshed;
          }
        } catch {
          // Refresh failed, user needs to login again
          clearTokens();
        }
      }
    }
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    return headers;
  }

  private async refreshAccessToken(refreshToken: string): Promise<string | null> {
    try {
      const { statusCode, body } = await request(`${this.baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (statusCode === 200) {
        const data = await body.json() as { 
          accessToken: string; 
          refreshToken: string;
          expiresIn: number;
        };
        
        saveTokens({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          expiresAt: Date.now() + (data.expiresIn * 1000),
        });
        
        return data.accessToken;
      }
    } catch {
      // Ignore refresh errors
    }
    return null;
  }

  async get<T>(path: string): Promise<T> {
    const headers = await this.getHeaders();
    
    const { statusCode, body } = await request(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers,
    });

    const data = await body.json();
    
    if (statusCode >= 400) {
      const error = data as ApiError;
      throw new Error(error.message ?? `Request failed with status ${statusCode}`);
    }

    return data as T;
  }

  async post<T>(path: string, payload?: unknown): Promise<T> {
    const headers = await this.getHeaders();
    
    const { statusCode, body } = await request(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
    });

    const data = await body.json();
    
    if (statusCode >= 400) {
      const error = data as ApiError;
      throw new Error(error.message ?? `Request failed with status ${statusCode}`);
    }

    return data as T;
  }

  async patch<T>(path: string, payload: unknown): Promise<T> {
    const headers = await this.getHeaders();
    
    const { statusCode, body } = await request(`${this.baseUrl}${path}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(payload),
    });

    const data = await body.json();
    
    if (statusCode >= 400) {
      const error = data as ApiError;
      throw new Error(error.message ?? `Request failed with status ${statusCode}`);
    }

    return data as T;
  }

  async delete<T>(path: string): Promise<T | null> {
    const headers = await this.getHeaders();
    
    const { statusCode, body } = await request(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers,
    });

    // 204 No Content
    if (statusCode === 204) {
      return null;
    }

    const data = await body.json();
    
    if (statusCode >= 400) {
      const error = data as ApiError;
      throw new Error(error.message ?? `Request failed with status ${statusCode}`);
    }

    return data as T;
  }

  // Login and save tokens
  async login(username: string, password: string): Promise<boolean> {
    try {
      const { statusCode, body } = await request(`${this.baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (statusCode === 200) {
        const data = await body.json() as {
          accessToken: string;
          refreshToken: string;
          expiresIn: number;
        };
        
        saveTokens({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          expiresAt: Date.now() + (data.expiresIn * 1000),
        });
        
        return true;
      }
      
      return false;
    } catch {
      return false;
    }
  }

  // Logout
  async logout(): Promise<void> {
    try {
      const refreshToken = getRefreshToken();
      if (refreshToken) {
        await this.post('/api/v1/auth/logout', { refreshToken });
      }
    } finally {
      clearTokens();
    }
  }

  // Check if authenticated
  isAuthenticated(): boolean {
    return !!(this.apiKey || getValidToken() || getRefreshToken());
  }
}

export const apiClient = new ApiClient();
