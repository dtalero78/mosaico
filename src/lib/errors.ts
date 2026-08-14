/**
 * Application Error Classes
 *
 * Custom error hierarchy for consistent error handling across all API routes.
 * These errors are caught by the handler/handlerWithAuth wrappers in api-helpers.ts
 * and automatically converted to proper HTTP responses.
 */

import 'server-only';

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string,
    /**
     * Datos estructurados del error, para que el cliente pueda hacer algo con él
     * además de mostrar el texto — p. ej. el modal que corrige una colisión de
     * horario necesita saber QUÉ curso choca y con cuáles.
     */
    public detail?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id?: string) {
    super(
      id ? `${entity} not found: ${id}` : `${entity} not found`,
      404,
      'NOT_FOUND'
    );
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string, detail?: unknown) {
    super(message, 409, 'CONFLICT', detail);
    this.name = 'ConflictError';
  }
}
