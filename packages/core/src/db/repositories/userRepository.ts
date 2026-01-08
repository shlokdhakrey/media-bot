/**
 * User Repository
 * 
 * Handles all user-related database operations.
 * Extends BaseRepository with user-specific methods.
 */

import { User, UserRole, Prisma } from '@prisma/client';
import { BaseRepository } from '../baseRepository.js';

type UserCreateInput = Prisma.UserCreateInput;
type UserUpdateInput = Prisma.UserUpdateInput;

export class UserRepository extends BaseRepository<User, UserCreateInput, UserUpdateInput> {
  constructor() {
    super('User');
  }

  protected getDelegate() {
    return this.prisma.user;
  }

  /**
   * Find user by username
   */
  async findByUsername(username: string): Promise<User | null> {
    return this.findFirst({ username });
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.findFirst({ email });
  }

  /**
   * Find user by Telegram ID
   */
  async findByTelegramId(telegramId: string): Promise<User | null> {
    return this.findFirst({ telegramId });
  }

  /**
   * Find all users with a specific role
   */
  async findByRole(role: UserRole): Promise<User[]> {
    return this.findMany({ role });
  }

  /**
   * Find all active users
   */
  async findActiveUsers(): Promise<User[]> {
    return this.findMany({ isActive: true });
  }

  /**
   * Get admins
   */
  async getAdmins(): Promise<User[]> {
    return this.findMany({ role: 'ADMIN', isActive: true });
  }

  /**
   * Update user's last active timestamp
   */
  async updateLastActive(id: string): Promise<User> {
    return this.update(id, { lastActiveAt: new Date() });
  }

  /**
   * Deactivate a user (soft delete)
   */
  async deactivate(id: string): Promise<User> {
    return this.update(id, { isActive: false });
  }

  /**
   * Activate a user
   */
  async activate(id: string): Promise<User> {
    return this.update(id, { isActive: true });
  }

  /**
   * Change user role
   */
  async changeRole(id: string, role: UserRole): Promise<User> {
    return this.update(id, { role });
  }

  /**
   * Update user preferences
   */
  async updatePreferences(id: string, preferences: Record<string, unknown>): Promise<User> {
    const user = await this.findByIdOrThrow(id);
    const currentPrefs = user.preferences as Record<string, unknown>;
    const mergedPrefs = { ...currentPrefs, ...preferences };
    return this.update(id, { preferences: mergedPrefs as Prisma.InputJsonValue });
  }

  /**
   * Create user with validation
   */
  async createUser(data: {
    username: string;
    email?: string;
    telegramId?: string;
    role?: UserRole;
  }): Promise<User> {
    // Check for duplicate username
    const existingUsername = await this.findByUsername(data.username);
    if (existingUsername) {
      throw new Error(`Username "${data.username}" already exists`);
    }

    // Check for duplicate email
    if (data.email) {
      const existingEmail = await this.findByEmail(data.email);
      if (existingEmail) {
        throw new Error(`Email "${data.email}" already exists`);
      }
    }

    // Check for duplicate Telegram ID
    if (data.telegramId) {
      const existingTelegram = await this.findByTelegramId(data.telegramId);
      if (existingTelegram) {
        throw new Error(`Telegram ID "${data.telegramId}" already exists`);
      }
    }

    return this.create({
      username: data.username,
      email: data.email,
      telegramId: data.telegramId,
      role: data.role || 'USER',
    });
  }
}

// Singleton instance
export const userRepository = new UserRepository();
