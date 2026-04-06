/**
 * Error handling middleware for Express
 */
import { FeishuError } from '../core/errors.js';

export function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  if (err instanceof SyntaxError && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      ok: false,
      error: 'invalid_json',
      message: 'Invalid JSON body',
    });
  }

  // Feishu API errors
  if (err instanceof FeishuError) {
    const statusCode = err.code === 'RATE_LIMIT' ? 429 : 502;

    return res.status(statusCode).json({
      ok: false,
      error: 'feishu_error',
      code: err.code,
      message: err.message,
      details: err.details,
    });
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      ok: false,
      error: 'validation_error',
      message: err.message,
      details: err.details,
    });
  }

  // Authentication errors
  if (err.name === 'AuthenticationError') {
    return res.status(401).json({
      ok: false,
      error: 'authentication_error',
      message: err.message,
    });
  }

  // Default server error
  return res.status(500).json({
    ok: false,
    error: 'internal_error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}
