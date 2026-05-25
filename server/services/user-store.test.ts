import Database from 'better-sqlite3';
import { UserStore } from './user-store';

let db: InstanceType<typeof Database>;
let store: UserStore;

beforeEach(() => {
  db = new Database(':memory:');
  store = new UserStore(db);
});

afterEach(() => {
  db.close();
});

describe('UserStore.createUser', () => {
  it('returns true on first registration', () => {
    expect(store.createUser('alice', 'secret')).toBe(true);
  });

  it('returns false on duplicate username', () => {
    store.createUser('alice', 'secret');
    expect(store.createUser('alice', 'other')).toBe(false);
  });
});

describe('UserStore.authenticate', () => {
  // KoReader sends MD5(password) in registration; createUser stores it as-is.
  beforeEach(() => store.createUser('alice', UserStore.hashPassword('secret')));

  it('returns true with correct MD5 key', () => {
    const key = UserStore.hashPassword('secret');
    expect(store.authenticate('alice', key)).toBe(true);
  });

  it('returns false with wrong key', () => {
    expect(store.authenticate('alice', 'wronghash')).toBe(false);
  });

  it('returns false for unknown user', () => {
    const key = UserStore.hashPassword('secret');
    expect(store.authenticate('nobody', key)).toBe(false);
  });
});

describe('UserStore.saveProgress + getProgress', () => {
  beforeEach(() => store.createUser('alice', 'secret'));

  it('retrieves saved progress', () => {
    store.saveProgress('alice', {
      document: 'abc123',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
    });
    const p = store.getProgress('alice', 'abc123');
    expect(p).not.toBeNull();
    expect(p!.progress).toBe('/body/DocFragment[5]');
    expect(p!.percentage).toBeCloseTo(0.42);
  });

  it('updates existing progress on conflict', () => {
    store.saveProgress('alice', {
      document: 'abc123',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
    });
    store.saveProgress('alice', {
      document: 'abc123',
      progress: '/body/DocFragment[10]',
      percentage: 0.8,
      device: 'Kobo',
      device_id: 'dev-1',
    });
    const p = store.getProgress('alice', 'abc123');
    expect(p!.percentage).toBeCloseTo(0.8);
  });

  it('returns null when no progress exists', () => {
    expect(store.getProgress('alice', 'unknown')).toBeNull();
  });
});

describe('UserStore.userExists', () => {
  it('returns false for unknown user', () => {
    expect(store.userExists('nobody')).toBe(false);
  });

  it('returns true for a registered user', () => {
    store.createUser('alice', 'secret');
    expect(store.userExists('alice')).toBe(true);
  });
});

describe('UserStore.listUsers', () => {
  it('returns empty array when no users', () => {
    expect(store.listUsers()).toEqual([]);
  });

  it('returns users sorted by username with progress count', () => {
    store.createUser('zara', 'pass');
    store.createUser('alice', 'pass');
    store.saveProgress('alice', {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    store.saveProgress('alice', {
      document: 'doc2',
      progress: '/p[1]',
      percentage: 0.2,
      device: 'Kobo',
      device_id: 'd1',
    });
    const users = store.listUsers();
    expect(users).toHaveLength(2);
    expect(users[0].username).toBe('alice');
    expect(users[0].progressCount).toBe(2);
    expect(users[1].username).toBe('zara');
    expect(users[1].progressCount).toBe(0);
  });
});

describe('UserStore.getUserProgress', () => {
  beforeEach(() => store.createUser('alice', 'pass'));

  it('returns empty array when user has no progress', () => {
    expect(store.getUserProgress('alice')).toEqual([]);
  });

  it('returns all progress records ordered by timestamp descending', () => {
    store.saveProgress('alice', {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.3,
      device: 'Kobo',
      device_id: 'd1',
      timestamp: 100,
    });
    store.saveProgress('alice', {
      document: 'doc2',
      progress: '/p[2]',
      percentage: 0.8,
      device: 'Kobo',
      device_id: 'd1',
      timestamp: 200,
    });
    const records = store.getUserProgress('alice');
    expect(records).toHaveLength(2);
    expect(records[0].document).toBe('doc2'); // most recent first
    expect(records[1].document).toBe('doc1');
  });

  it('only returns records for the specified user', () => {
    store.createUser('bob', 'pass');
    store.saveProgress('alice', {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    store.saveProgress('bob', {
      document: 'doc2',
      progress: '/p[1]',
      percentage: 0.3,
      device: 'Kobo',
      device_id: 'd2',
    });
    expect(store.getUserProgress('alice')).toHaveLength(1);
    expect(store.getUserProgress('alice')[0].document).toBe('doc1');
  });
});

describe('UserStore.deleteUser', () => {
  beforeEach(() => {
    store.createUser('alice', 'pass');
    store.saveProgress('alice', {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
  });

  it('returns false for unknown user', () => {
    expect(store.deleteUser('nobody')).toBe(false);
  });

  it('returns true and removes the user', () => {
    expect(store.deleteUser('alice')).toBe(true);
    expect(store.userExists('alice')).toBe(false);
  });

  it('cascades to delete all progress records', () => {
    store.deleteUser('alice');
    expect(store.getUserProgress('alice')).toEqual([]);
  });

  it('does not affect other users', () => {
    store.createUser('bob', 'pass');
    store.deleteUser('alice');
    expect(store.userExists('bob')).toBe(true);
  });
});

describe('UserStore.validateUser', () => {
  beforeEach(() => store.createUser('alice', UserStore.hashPassword('secret')));

  it('returns true with correct plaintext password', () => {
    expect(store.validateUser('alice', 'secret')).toBe(true);
  });

  it('returns false with wrong password', () => {
    expect(store.validateUser('alice', 'wrongpass')).toBe(false);
  });

  it('returns false for unknown user', () => {
    expect(store.validateUser('nobody', 'secret')).toBe(false);
  });
});

describe('UserStore.clearProgress', () => {
  beforeEach(() => {
    store.createUser('alice', 'pass');
    store.createUser('bob', 'pass');
  });

  it('returns false when no record exists', () => {
    expect(store.clearProgress('alice', 'doc1')).toBe(false);
  });

  it('deletes an existing record and returns true', () => {
    store.saveProgress('alice', {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    expect(store.clearProgress('alice', 'doc1')).toBe(true);
    expect(store.getProgress('alice', 'doc1')).toBeNull();
  });

  it("does not affect another user's progress for the same document", () => {
    store.saveProgress('alice', {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    store.saveProgress('bob', {
      document: 'doc1',
      progress: '/p[2]',
      percentage: 0.7,
      device: 'Kobo',
      device_id: 'd2',
    });
    store.clearProgress('alice', 'doc1');
    expect(store.getProgress('bob', 'doc1')).not.toBeNull();
  });
});
