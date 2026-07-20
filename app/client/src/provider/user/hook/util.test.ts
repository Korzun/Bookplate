import { describe, expect, it } from 'vite-plus/test';

import type { UserList } from '../type';

import { removeUserByUsername } from './util';

describe('removeUserByUsername', () => {
  it('removes the named user and leaves others intact', () => {
    const list: UserList = {
      alice: { username: 'alice', progressCount: 0 },
      bob: { username: 'bob', progressCount: 1 },
    };
    expect(removeUserByUsername('alice', list)).toEqual({
      bob: { username: 'bob', progressCount: 1 },
    });
  });

  it('returns unchanged list when username is absent', () => {
    const list: UserList = { bob: { username: 'bob', progressCount: 1 } };
    expect(removeUserByUsername('alice', list)).toEqual(list);
  });

  it('returns empty object when removing the only user', () => {
    const list: UserList = { alice: { username: 'alice', progressCount: 0 } };
    expect(removeUserByUsername('alice', list)).toEqual({});
  });
});
