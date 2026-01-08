/**
 * User Types
 */

export type UserRole = 'admin' | 'user' | 'readonly';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  
  // Optional identifiers
  email?: string;
  telegramId?: string;
  
  // Preferences
  preferences: Record<string, unknown>;
  
  // Status
  isActive: boolean;
  lastActiveAt?: Date;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}
