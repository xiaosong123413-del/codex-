/**
 * Body parser middleware for JSON
 * Simple implementation without needing body-parser package
 */
export function jsonBodyParser(req, res, next) {
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') {
    return next();
  }

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    return next();
  }

  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', () => {
    try {
      req.body = body ? JSON.parse(body) : {};
      next();
    } catch (error) {
      next(new Error('Invalid JSON body'));
    }
  });

  req.on('error', next);
}
