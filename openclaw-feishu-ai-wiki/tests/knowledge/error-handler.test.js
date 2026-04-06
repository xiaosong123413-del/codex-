import test from 'node:test';
import assert from 'node:assert/strict';

import { errorHandler } from '../../src/middleware/errorHandler.js';

function createFakeResponse() {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

test('非法 JSON 请求体会返回 400', () => {
  const error = new SyntaxError('Unexpected token');
  error.type = 'entity.parse.failed';

  const res = createFakeResponse();
  errorHandler(error, {}, res, () => {});

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, {
    ok: false,
    error: 'invalid_json',
    message: 'Invalid JSON body',
  });
});
