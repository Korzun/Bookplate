export type Release = () => void;
export type CheckSlots = {
  tryAcquire(): Release | null;
  acquire(): Promise<Release>;
  inFlight(): number;
};

export const MAX_CHECKING = 2;

export function createCheckSlots(max: number): CheckSlots {
  let active = 0;
  const waiters: Array<(release: Release) => void> = [];

  function makeRelease(): Release {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = waiters.shift();
      // Hand the slot straight to the next waiter; `active` stays the same.
      if (next) next(makeRelease());
      else active--;
    };
  }

  return {
    tryAcquire() {
      if (active >= max) return null;
      active++;
      return makeRelease();
    },
    acquire() {
      const release = this.tryAcquire();
      if (release) return Promise.resolve(release);
      return new Promise<Release>((resolve) => waiters.push(resolve));
    },
    inFlight: () => active,
  };
}

export const argonSlots: CheckSlots = createCheckSlots(MAX_CHECKING);
