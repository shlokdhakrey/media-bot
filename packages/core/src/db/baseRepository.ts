/**
 * Base Repository Pattern
 * 
 * Provides common CRUD operations for all models.
 * Specific repositories extend this with model-specific methods.
 * 
 * Design Decisions:
 * - Generic typing for type safety
 * - Consistent error handling
 * - Audit logging hooks
 * - Soft delete support where applicable
 */

import { prisma, PrismaClient } from './client.js';
import { logger } from '../logger.js';

export interface PaginationOptions {
  page?: number;
  limit?: number;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export abstract class BaseRepository<T, CreateInput, UpdateInput> {
  protected readonly modelName: string;
  protected readonly prisma: PrismaClient;

  constructor(modelName: string) {
    this.modelName = modelName;
    this.prisma = prisma;
  }

  /**
   * Get the Prisma delegate for this model
   * Must be implemented by subclasses
   */
  protected abstract getDelegate(): any;

  /**
   * Find a record by ID
   */
  async findById(id: string): Promise<T | null> {
    try {
      const result = await this.getDelegate().findUnique({
        where: { id },
      });
      return result as T | null;
    } catch (error) {
      logger.error(
        { model: this.modelName, id, error: (error as Error).message },
        'Error finding record by ID'
      );
      throw error;
    }
  }

  /**
   * Find a record by ID or throw
   */
  async findByIdOrThrow(id: string): Promise<T> {
    const result = await this.findById(id);
    if (!result) {
      throw new Error(`${this.modelName} with ID ${id} not found`);
    }
    return result;
  }

  /**
   * Find all records with optional pagination
   */
  async findAll(options: PaginationOptions = {}): Promise<PaginatedResult<T>> {
    const { page = 1, limit = 20, orderBy = 'createdAt', orderDir = 'desc' } = options;
    const skip = (page - 1) * limit;

    try {
      const [data, total] = await Promise.all([
        this.getDelegate().findMany({
          skip,
          take: limit,
          orderBy: { [orderBy]: orderDir },
        }),
        this.getDelegate().count(),
      ]);

      const totalPages = Math.ceil(total / limit);

      return {
        data: data as T[],
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      };
    } catch (error) {
      logger.error(
        { model: this.modelName, options, error: (error as Error).message },
        'Error finding all records'
      );
      throw error;
    }
  }

  /**
   * Find records by filter
   */
  async findMany(where: Record<string, unknown>): Promise<T[]> {
    try {
      const results = await this.getDelegate().findMany({ where });
      return results as T[];
    } catch (error) {
      logger.error(
        { model: this.modelName, where, error: (error as Error).message },
        'Error finding records by filter'
      );
      throw error;
    }
  }

  /**
   * Find first record matching filter
   */
  async findFirst(where: Record<string, unknown>): Promise<T | null> {
    try {
      const result = await this.getDelegate().findFirst({ where });
      return result as T | null;
    } catch (error) {
      logger.error(
        { model: this.modelName, where, error: (error as Error).message },
        'Error finding first record'
      );
      throw error;
    }
  }

  /**
   * Create a new record
   */
  async create(data: CreateInput): Promise<T> {
    try {
      const result = await this.getDelegate().create({ data });
      logger.info({ model: this.modelName, id: (result as any).id }, 'Record created');
      return result as T;
    } catch (error) {
      logger.error(
        { model: this.modelName, error: (error as Error).message },
        'Error creating record'
      );
      throw error;
    }
  }

  /**
   * Create multiple records
   */
  async createMany(data: CreateInput[]): Promise<{ count: number }> {
    try {
      const result = await this.getDelegate().createMany({ data });
      logger.info({ model: this.modelName, count: result.count }, 'Records created');
      return result;
    } catch (error) {
      logger.error(
        { model: this.modelName, error: (error as Error).message },
        'Error creating multiple records'
      );
      throw error;
    }
  }

  /**
   * Update a record by ID
   */
  async update(id: string, data: UpdateInput): Promise<T> {
    try {
      const result = await this.getDelegate().update({
        where: { id },
        data,
      });
      logger.info({ model: this.modelName, id }, 'Record updated');
      return result as T;
    } catch (error) {
      logger.error(
        { model: this.modelName, id, error: (error as Error).message },
        'Error updating record'
      );
      throw error;
    }
  }

  /**
   * Update multiple records
   */
  async updateMany(
    where: Record<string, unknown>,
    data: UpdateInput
  ): Promise<{ count: number }> {
    try {
      const result = await this.getDelegate().updateMany({ where, data });
      logger.info({ model: this.modelName, count: result.count }, 'Records updated');
      return result;
    } catch (error) {
      logger.error(
        { model: this.modelName, where, error: (error as Error).message },
        'Error updating multiple records'
      );
      throw error;
    }
  }

  /**
   * Delete a record by ID
   */
  async delete(id: string): Promise<T> {
    try {
      const result = await this.getDelegate().delete({
        where: { id },
      });
      logger.info({ model: this.modelName, id }, 'Record deleted');
      return result as T;
    } catch (error) {
      logger.error(
        { model: this.modelName, id, error: (error as Error).message },
        'Error deleting record'
      );
      throw error;
    }
  }

  /**
   * Delete multiple records
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    try {
      const result = await this.getDelegate().deleteMany({ where });
      logger.info({ model: this.modelName, count: result.count }, 'Records deleted');
      return result;
    } catch (error) {
      logger.error(
        { model: this.modelName, where, error: (error as Error).message },
        'Error deleting multiple records'
      );
      throw error;
    }
  }

  /**
   * Count records matching filter
   */
  async count(where?: Record<string, unknown>): Promise<number> {
    try {
      return await this.getDelegate().count({ where });
    } catch (error) {
      logger.error(
        { model: this.modelName, where, error: (error as Error).message },
        'Error counting records'
      );
      throw error;
    }
  }

  /**
   * Check if a record exists
   */
  async exists(id: string): Promise<boolean> {
    const count = await this.count({ id });
    return count > 0;
  }

  /**
   * Upsert (create or update) a record
   */
  async upsert(
    where: Record<string, unknown>,
    create: CreateInput,
    update: UpdateInput
  ): Promise<T> {
    try {
      const result = await this.getDelegate().upsert({
        where,
        create,
        update,
      });
      logger.info({ model: this.modelName, id: (result as any).id }, 'Record upserted');
      return result as T;
    } catch (error) {
      logger.error(
        { model: this.modelName, where, error: (error as Error).message },
        'Error upserting record'
      );
      throw error;
    }
  }
}
