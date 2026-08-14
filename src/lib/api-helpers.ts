/**
 * API Route Handler Helpers
 *
 * Provides wrapper functions that eliminate boilerplate from route handlers:
 * - Automatic try/catch with consistent error responses
 * - Optional authentication check via handlerWithAuth
 * - Standard success/error response format
 *
 * Usage:
 *   // Public route
 *   export const GET = handler(async (req, ctx) => {
 *     const data = await someQuery();
 *     return successResponse({ data });
 *   });
 *
 *   // Authenticated route
 *   export const POST = handlerWithAuth(async (req, ctx, session) => {
 *     const body = await req.json();
 *     return successResponse({ result });
 *   });
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession, Session } from 'next-auth';
import { authOptions } from '@/lib/auth-postgres';
import { AppError, UnauthorizedError } from './errors';

// Route context type matching Next.js App Router.
// Aceptamos `NextRequest` (lo que Next.js pasa en runtime). Es asignable a
// `Request`, así handlers tipados con cualquiera de los dos compilan.
type RouteContext = { params: Record<string, string> };

type HandlerFn = (
  request: NextRequest,
  context: RouteContext
) => Promise<NextResponse>;

type AuthHandlerFn = (
  request: NextRequest,
  context: RouteContext,
  session: Session
) => Promise<NextResponse>;

/**
 * Standard success response
 * Spreads the data object into the response so callers can pass any shape.
 *
 * Example: successResponse({ advisors, total: 5 })
 * Returns: { success: true, advisors: [...], total: 5 }
 */
export function successResponse<T extends Record<string, any>>(data: T, status: number = 200) {
  return NextResponse.json({ success: true, ...data }, { status });
}

/**
 * Convert an AppError to an HTTP response
 */
export function errorResponse(error: AppError) {
  return NextResponse.json(
    {
      success: false,
      error: error.message,
      code: error.code,
      // Sólo viaja si el error lo trae; los demás responden igual que siempre.
      ...(error.detail !== undefined ? { detail: error.detail } : {}),
    },
    { status: error.statusCode }
  );
}

/**
 * Wrap a route handler with automatic error handling.
 * AppErrors are converted to proper HTTP responses.
 * Unknown errors return 500 with the error message.
 */
export function handler(fn: HandlerFn) {
  return async (request: NextRequest, context: RouteContext) => {
    try {
      return await fn(request, context);
    } catch (error: any) {
      if (error instanceof AppError) {
        return errorResponse(error);
      }
      console.error('Unhandled error:', error);
      return NextResponse.json(
        {
          success: false,
          error: 'Database error',
          details: error.message,
        },
        { status: 500 }
      );
    }
  };
}

/**
 * Wrap a route handler with authentication + error handling.
 * Checks for a valid NextAuth session before executing the handler.
 * The session is passed as the third argument to the handler function.
 */
export function handlerWithAuth(fn: AuthHandlerFn) {
  return handler(async (request, context) => {
    const session = await getServerSession(authOptions);
    if (!session) {
      throw new UnauthorizedError();
    }
    return fn(request, context, session);
  });
}
