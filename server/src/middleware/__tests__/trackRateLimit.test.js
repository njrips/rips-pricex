const { createTrackRateLimit } = require('../trackRateLimit');

function run(limiter, ip) {
  const res = {
    statusCode: 200,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  };
  let passed = false;
  limiter({ ip }, res, () => {
    passed = true;
  });
  return { passed, res };
}

describe('createTrackRateLimit', () => {
  it('lets an address through up to the ceiling, then answers 429 until the window turns', () => {
    let clock = 0;
    const limiter = createTrackRateLimit({ limit: 2, windowMs: 1000, now: () => clock });
    expect(run(limiter, '1.1.1.1').passed).toBe(true);
    expect(run(limiter, '1.1.1.1').passed).toBe(true);
    const blocked = run(limiter, '1.1.1.1');
    expect(blocked.passed).toBe(false);
    expect(blocked.res.statusCode).toBe(429);
    expect(blocked.res.headers['Retry-After']).toBe('1');
    expect(run(limiter, '2.2.2.2').passed).toBe(true);
    clock = 1000;
    expect(run(limiter, '1.1.1.1').passed).toBe(true);
  });
});
