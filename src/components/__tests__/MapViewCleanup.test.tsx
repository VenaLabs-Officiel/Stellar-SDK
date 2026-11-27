import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEffect, useRef, type ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MapView } from '../core/MapView';
import type { VenalabsMap } from '../../types';

// ------------------------------------------------------------------
// The zoom library is replaced by a wrapper that only reports its
// initialisation, with a spy in place of the zoom action
// ------------------------------------------------------------------

const mocks = vi.hoisted(() => ({ zoomToElement: vi.fn() }));

vi.mock('react-zoom-pan-pinch', () => ({
  TransformWrapper: ({
    children,
    onInit,
  }: {
    children: ReactNode;
    onInit?: (instance: unknown) => void;
  }) => {
    // Like the library, the initialisation is reported once
    const reported = useRef(false);
    useEffect(() => {
      if (reported.current) return;
      reported.current = true;
      onInit?.({ zoomToElement: mocks.zoomToElement });
    }, [onInit]);
    return <div>{children}</div>;
  },
  TransformComponent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const map: VenalabsMap = {
  id: 'map-1',
  organizationId: 'org-1',
  name: 'Map',
  nodes: [{ id: 'node-1', courseId: 'course-1', courseName: { en: 'Course' }, x: 0, y: 0 }],
  connections: [],
  status: 'PUBLISHED',
  createdOn: '',
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  mocks.zoomToElement.mockClear();
});

describe('MapView: initial zoom timer', () => {
  it('centres the map on the target course shortly after it is displayed', async () => {
    render(<MapView maps={[map]} progress={[]} />);

    expect(mocks.zoomToElement).not.toHaveBeenCalled();
    await wait(200);

    expect(mocks.zoomToElement).toHaveBeenCalledTimes(1);
    expect(mocks.zoomToElement).toHaveBeenCalledWith('venalabs-node-node-1', 0.8, 500);
  });

  it('cancels the zoom when the map is removed before the timer fires', async () => {
    const { unmount } = render(<MapView maps={[map]} progress={[]} />);

    // The user opens a course (or the host removes the SDK) right away
    unmount();
    await wait(200);

    // Zooming a map that is gone touches a DOM that no longer exists
    expect(mocks.zoomToElement).not.toHaveBeenCalled();
  });
});
