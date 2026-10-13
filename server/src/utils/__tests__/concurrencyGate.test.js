const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createConcurrencyGate } = require('../concurrencyGate');

const tick = () => new Promise(resolve => setImmediate(resolve));

describe('createConcurrencyGate', () => {
  it('never runs more than its limit at once', async () => {
    const gate = createConcurrencyGate(2);
    let running = 0;
    let peak = 0;
    const job = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      await tick();
      running -= 1;
    };

    await Promise.all(Array.from({ length: 9 }, () => gate.run(job)));

    assert.equal(peak, 2);
    assert.equal(gate.active, 0);
    assert.equal(gate.waiting, 0);
  });

  it('hands a freed slot to the next waiter before a newcomer', async () => {
    const gate = createConcurrencyGate(1);
    const order = [];
    let releaseFirst;
    const first = gate.run(
      () =>
        new Promise(resolve => {
          releaseFirst = resolve;
        })
    );
    const second = gate.run(async () => order.push('waiter'));
    await tick();
    releaseFirst();
    const third = gate.run(async () => order.push('newcomer'));

    await Promise.all([first, second, third]);

    assert.deepEqual(order, ['waiter', 'newcomer']);
  });

  it('frees the slot when a job fails', async () => {
    const gate = createConcurrencyGate(1);

    await assert.rejects(gate.run(async () => {
      throw new Error('boom');
    }));
    const value = await gate.run(async () => 'next');

    assert.equal(value, 'next');
    assert.equal(gate.active, 0);
  });
});
