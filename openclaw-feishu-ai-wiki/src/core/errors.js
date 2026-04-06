/**
 * Core error classes for Feishu integration
 */

export class FeishuError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'FeishuError';
    this.code = code;
    this.details = details;
  }
}

export class AuthenticationError extends FeishuError {
  constructor(message = 'Authentication failed', details = {}) {
    super(message, 'AUTH_ERROR', details);
    this.name = 'AuthenticationError';
  }
}

export class ValidationError extends FeishuError {
  constructor(message = 'Validation failed', details = {}) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class RateLimitError extends FeishuError {
  constructor(message = 'Rate limit exceeded', details = {}) {
    super(message, 'RATE_LIMIT', details);
    this.name = 'RateLimitError';
  }
}

export class NotFoundError extends FeishuError {
  constructor(message = 'Resource not found', details = {}) {
    super(message, 'NOT_FOUND', details);
    this.name = 'NotFoundError';
  }
}

export class PermissionError extends FeishuError {
  constructor(message = 'Permission denied', details = {}) {
    super(message, 'PERMISSION_DENIED', details);
    this.name = 'PermissionError';
  }
}

/**
 * Parse Feishu API error response
 */
export function parseFeishuError(data) {
  const code = data.code || 0;
  const msg = data.msg || 'Unknown error';
  const details = data.data || {};

  switch (code) {
    case 20001:
      return new AuthenticationError(msg, details);
    case 20002:
      return new ValidationError(msg, details);
    case 20004:
      return new RateLimitError(msg, details);
    case 20005:
      return new PermissionError(msg, details);
    case 240001:
      return new NotFoundError(msg, details);
    default:
      return new FeishuError(msg, code, details);
  }
}
