import { argonSlots, createCheckSlots, MAX_CHECKING } from './check-slots';

describe('createCheckSlots', () => {
  it('tryAcquire gives out at most max slots', () => {
    const slots = createCheckSlots(2);
    expect(slots.tryAcquire()).toBeTypeOf('function');
    expect(slots.tryAcquire()).toBeTypeOf('function');
    expect(slots.tryAcquire()).toBeNull();
    expect(slots.inFlight()).toBe(2);
  });

  it('release frees a slot and is idempotent', () => {
    const slots = createCheckSlots(2);
    const a = slots.tryAcquire()!;
    slots.tryAcquire()!;
    a();
    a();
    expect(slots.inFlight()).toBe(1);
  });

  it('acquire waits for a slot, FIFO', async () => {
    const slots = createCheckSlots(2);
    const a = slots.tryAcquire()!;
    const b = slots.tryAcquire()!;
    const order: number[] = [];
    const first = slots.acquire().then((r) => (order.push(1), r));
    const second = slots.acquire().then((r) => (order.push(2), r));
    a();
    const r1 = await first;
    await Promise.resolve();
    expect(order).toEqual([1]);
    expect(slots.inFlight()).toBe(2);
    b();
    await second;
    expect(order).toEqual([1, 2]);
    r1();
  });

  it('exposes MAX_CHECKING and a process-wide argonSlots', () => {
    expect(MAX_CHECKING).toBe(2);
    expect(argonSlots.inFlight()).toBe(0);
  });
});
