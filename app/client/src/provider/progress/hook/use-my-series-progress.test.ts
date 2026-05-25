import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { UseUsername } from '../../auth/hook/use-username';

import { useMySeriesProgress } from './use-my-series-progress';
import type { UseUserSeriesProgress } from './use-user-series-progress';

vi.mock('../../auth/hook/use-username');
vi.mock('./use-user-series-progress');

const { useUsername } = await import('../../auth/hook/use-username');
const { useUserSeriesProgress } = await import('./use-user-series-progress');
const mockUseUsername = vi.mocked(useUsername);
const mockUseUserSeriesProgress = vi.mocked(useUserSeriesProgress);

function stubUsername(tuple: UseUsername) {
  mockUseUsername.mockReturnValue(tuple);
}

function stubSeriesProgress(tuple: UseUserSeriesProgress) {
  mockUseUserSeriesProgress.mockReturnValue(tuple);
}

describe('useMySeriesProgress', () => {
  it('returns username error state when useUsername has an error', () => {
    stubUsername([undefined, false, true, 'Not authenticated']);
    stubSeriesProgress([undefined, false, false, undefined]);
    const { result } = renderHook(() => useMySeriesProgress('Dune'));
    expect(result.current).toEqual([undefined, false, true, 'Not authenticated']);
  });

  it('returns username error state without message', () => {
    stubUsername([undefined, false, true, undefined]);
    stubSeriesProgress([undefined, false, false, undefined]);
    const { result } = renderHook(() => useMySeriesProgress('Dune'));
    expect(result.current).toEqual([undefined, false, true, undefined]);
  });

  it('returns progress error state when useUserSeriesProgress has an error', () => {
    stubUsername(['alice', false, false, undefined]);
    stubSeriesProgress([undefined, false, true, 'Fetch failed']);
    const { result } = renderHook(() => useMySeriesProgress('Dune'));
    expect(result.current).toEqual([undefined, false, true, 'Fetch failed']);
  });

  it('returns loading state when username is loading', () => {
    stubUsername([undefined, true, false, undefined]);
    stubSeriesProgress([undefined, false, false, undefined]);
    const { result } = renderHook(() => useMySeriesProgress('Dune'));
    expect(result.current[1]).toBe(true);
  });

  it('returns loading state when series progress is loading', () => {
    stubUsername(['alice', false, false, undefined]);
    stubSeriesProgress([undefined, true, false, undefined]);
    const { result } = renderHook(() => useMySeriesProgress('Dune'));
    expect(result.current[1]).toBe(true);
  });

  it('carries existing progress value while series is reloading', () => {
    stubUsername(['alice', false, false, undefined]);
    stubSeriesProgress([0.75, true, false, undefined]);
    const { result } = renderHook(() => useMySeriesProgress('Dune'));
    expect(result.current).toEqual([0.75, true, false, undefined]);
  });

  it('returns the series progress when both username and progress are loaded', () => {
    stubUsername(['alice', false, false, undefined]);
    stubSeriesProgress([0.6, false, false, undefined]);
    const { result } = renderHook(() => useMySeriesProgress('Dune'));
    expect(result.current).toEqual([0.6, false, false, undefined]);
  });

  it('returns undefined series progress when no books in the series have progress', () => {
    stubUsername(['alice', false, false, undefined]);
    stubSeriesProgress([undefined, false, false, undefined]);
    const { result } = renderHook(() => useMySeriesProgress('Dune'));
    expect(result.current).toEqual([undefined, false, false, undefined]);
  });

  it('passes username to useUserSeriesProgress', () => {
    stubUsername(['alice', false, false, undefined]);
    stubSeriesProgress([undefined, false, false, undefined]);
    renderHook(() => useMySeriesProgress('Dune'));
    expect(mockUseUserSeriesProgress).toHaveBeenCalledWith('alice', 'Dune');
  });
});
