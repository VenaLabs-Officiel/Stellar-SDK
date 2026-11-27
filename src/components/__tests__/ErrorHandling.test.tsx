import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { VenalabsStellarSDK } from '../VenalabsStellarSDK';
import { CourseDetailView } from '../core/CourseDetailView';
import { StepView } from '../core/StepView';
import { VenalabsApiError } from '../../api';
import type { VenalabsCourse, VenalabsMap, VenalabsProgress } from '../../types';

const BASE_URL = 'https://api.test.com';
const SDK = `${BASE_URL}/api/v1/sdk`;

const map: VenalabsMap = {
  id: 'map-1',
  organizationId: 'org-1',
  name: 'Test Learning Map',
  nodes: [{ id: 'node-1', courseId: 'course-1', courseName: { en: 'Intro course' }, x: 0, y: 0 }],
  connections: [],
  status: 'PUBLISHED',
  createdOn: '',
};

const course: VenalabsCourse = {
  id: 'course-1',
  organizationId: 'org-1',
  title: { en: 'Intro course' },
  steps: [
    {
      id: 'step-1',
      title: { en: 'Read this' },
      type: 'TEXT',
      order: 0,
      textContent: { content: { en: [] } },
    },
  ],
  status: 'PUBLISHED',
  createdOn: '',
};

const inProgress: VenalabsProgress = {
  id: 'progress-1',
  organizationId: 'org-1',
  externalUserId: 'user-1',
  courseId: 'course-1',
  status: 'IN_PROGRESS',
  stepProgress: [],
};

const server = setupServer(
  http.get(`${SDK}/maps`, () => HttpResponse.json([map])),
  http.get(`${SDK}/progress`, () => HttpResponse.json([])),
  http.get(`${SDK}/wallet`, () => HttpResponse.json({ walletAddresses: {} })),
  http.get(`${SDK}/courses/course-1`, () => HttpResponse.json(course))
);

// Every rejection must be handled by the SDK: an unhandled one fails the test
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  process.on('unhandledRejection', onUnhandled);
});
afterAll(() => {
  server.close();
  process.off('unhandledRejection', onUnhandled);
});
afterEach(async () => {
  server.resetHandlers();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const seen = [...unhandled];
  unhandled.length = 0;
  expect(seen).toEqual([]);
});

function renderSdk() {
  return render(
    <VenalabsStellarSDK
      apiKey="test-key"
      getAccessToken={() => Promise.resolve('test-token')}
      baseUrl={BASE_URL}
    />
  );
}

async function openCourse() {
  const card = (await screen.findByText('Intro course')).closest('.venalabs-course-card');
  fireEvent.click(card!);
}

describe('Starting a course', () => {
  it('shows a message and re-enables the button when the request fails', async () => {
    const onStartCourse = vi.fn().mockRejectedValue(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<CourseDetailView course={course} progress={null} onStartCourse={onStartCourse} />);
    const start = screen.getByRole('button', { name: 'Start' });
    fireEvent.click(start);

    expect(
      await screen.findByText('The course could not be started. Please try again.')
    ).toBeInTheDocument();
    expect(start).toBeEnabled();
    errorSpy.mockRestore();
  });

  it('shows the message inside the SDK when POST start fails', async () => {
    server.use(
      http.post(`${SDK}/courses/course-1/start`, () =>
        HttpResponse.json({ message: 'Server error' }, { status: 500 })
      )
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderSdk();
    await openCourse();
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));

    expect(
      await screen.findByText('The course could not be started. Please try again.')
    ).toBeInTheDocument();
    // Still on the course page, ready for another attempt
    expect(document.querySelector('.venalabs-course-detail')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
    errorSpy.mockRestore();
  });
});

describe('Completing a step', () => {
  const renderStep = (onComplete: () => Promise<VenalabsProgress | undefined>) =>
    render(
      <StepView course={course} stepId="step-1" progress={inProgress} onComplete={onComplete} />
    );

  it('shows a message and re-enables the button when the request fails', async () => {
    renderStep(vi.fn().mockRejectedValue(new Error('boom')));
    const button = screen.getByRole('button', { name: 'Mark as complete' });
    fireEvent.click(button);

    expect(
      await screen.findByText('This step could not be completed. Please try again.')
    ).toBeInTheDocument();
    await waitFor(() => expect(button).toBeEnabled());
  });

  it('asks for the verification when the backend answers 409 VERIFICATION_REQUIRED', async () => {
    const refused = VenalabsApiError.fromResponse(409, {
      code: 'VERIFICATION_REQUIRED',
      message: 'This step must be verified before it can be completed',
    });
    renderStep(vi.fn().mockRejectedValue(refused));
    fireEvent.click(screen.getByRole('button', { name: 'Mark as complete' }));

    expect(
      await screen.findByText('This step must be verified before it can be completed.')
    ).toBeInTheDocument();
  });

  it('clears the message when the user moves to another step', async () => {
    const twoSteps: VenalabsCourse = {
      ...course,
      steps: [
        ...course.steps,
        {
          id: 'step-2',
          title: { en: 'Read that' },
          type: 'TEXT',
          order: 1,
          textContent: { content: { en: [] } },
        },
      ],
    };
    const onComplete = vi.fn().mockRejectedValue(new Error('boom'));
    const { rerender } = render(
      <StepView course={twoSteps} stepId="step-1" progress={inProgress} onComplete={onComplete} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mark as complete' }));
    await screen.findByText('This step could not be completed. Please try again.');

    rerender(
      <StepView course={twoSteps} stepId="step-2" progress={inProgress} onComplete={onComplete} />
    );

    expect(
      screen.queryByText('This step could not be completed. Please try again.')
    ).not.toBeInTheDocument();
  });
});

describe('Loading a course', () => {
  it('shows an error with a way back instead of an endless loader', async () => {
    server.use(
      http.get(`${SDK}/courses/course-1`, () =>
        HttpResponse.json({ message: 'Course not found' }, { status: 404 })
      )
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderSdk();
    await openCourse();

    expect(
      await screen.findByText('This course could not be loaded. Please try again.')
    ).toBeInTheDocument();
    expect(document.querySelector('.venalabs-loading-container')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to Map' }));
    expect(await screen.findByText('Test Learning Map')).toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it('loads the course when the user retries', async () => {
    let failing = true;
    server.use(
      http.get(`${SDK}/courses/course-1`, () =>
        failing
          ? HttpResponse.json({ message: 'Course not found' }, { status: 404 })
          : HttpResponse.json(course)
      )
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderSdk();
    await openCourse();
    await screen.findByText('This course could not be loaded. Please try again.');

    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    await waitFor(() => {
      expect(document.querySelector('.venalabs-course-detail')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    errorSpy.mockRestore();
  });
});

describe('Reloading the maps', () => {
  it('shows the loader while retrying, then the map', async () => {
    let failing = true;
    let releaseRetry: () => void = () => {};
    const retryGate = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    server.use(
      http.get(`${SDK}/maps`, async () => {
        if (failing) {
          return HttpResponse.json({ type: 'INVALID_API_KEY' }, { status: 403 });
        }
        await retryGate;
        return HttpResponse.json([map]);
      })
    );

    renderSdk();
    const retry = await screen.findByRole('button', { name: 'Try Again' });

    failing = false;
    fireEvent.click(retry);

    // The error view gives way to the loading state during the retry
    await waitFor(() => {
      expect(document.querySelector('.venalabs-sdk-loading')).toBeInTheDocument();
    });
    expect(document.querySelector('.venalabs-sdk-error')).not.toBeInTheDocument();

    releaseRetry();
    expect(await screen.findByText('Test Learning Map')).toBeInTheDocument();
    expect(document.querySelector('.venalabs-sdk-loading')).not.toBeInTheDocument();
  });
});
