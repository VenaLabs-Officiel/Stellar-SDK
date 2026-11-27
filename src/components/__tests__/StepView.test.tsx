import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { StepView } from '../core/StepView';
import { VenalabsApiClient } from '../../api';
import type { VenalabsCourse, VenalabsCourseStep, VenalabsProgress } from '../../types';

// ------------------------------------------------------------------
// Wallet context mock (no wallet kit is loaded in these tests)
// ------------------------------------------------------------------

const USER_ADDRESS = 'GUSERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUSER';

const mocks = vi.hoisted(() => ({
  wallet: { current: {} as Record<string, unknown> },
}));

vi.mock('../../wallet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../wallet')>();
  return {
    ...actual,
    useStellarWallet: () => mocks.wallet.current,
    StellarWalletProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

beforeEach(() => {
  mocks.wallet.current = {
    kit: null,
    isInitialized: true,
    network: 'TESTNET',
    stellarAddress: USER_ADDRESS,
    isConnected: true,
    isConnecting: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signMessage: vi.fn(),
    signTransaction: vi.fn(),
  };
});

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------

function quizStep(id: string, order: number, options: string[]): VenalabsCourseStep {
  return {
    id,
    title: { en: `Quiz ${id}` },
    type: 'QUIZ',
    order,
    quizContent: {
      question: { en: `Question ${id}` },
      options: options.map((text) => ({ text: { en: text } })),
      correctOptionIndex: 1,
    },
  };
}

function makeCourse(steps: VenalabsCourseStep[]): VenalabsCourse {
  return {
    id: 'course-1',
    organizationId: 'org-1',
    title: { en: 'Course' },
    steps,
    status: 'PUBLISHED',
    createdOn: '',
  };
}

const inProgress: VenalabsProgress = {
  id: 'progress-1',
  organizationId: 'org-1',
  externalUserId: 'user-1',
  courseId: 'course-1',
  status: 'IN_PROGRESS',
  stepProgress: [],
};

function makeClient() {
  return new VenalabsApiClient({
    apiKey: 'test-key',
    getAccessToken: () => Promise.resolve('test-token'),
    baseUrl: 'https://api.test.com',
  });
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe('StepView: one StepContent instance per step', () => {
  it('does not carry the local state of a step over to the next one', () => {
    const course = makeCourse([
      quizStep('step-a', 0, ['A wrong', 'A right']),
      quizStep('step-b', 1, ['B wrong', 'B right']),
    ]);

    const { rerender } = render(
      <StepView course={course} stepId="step-a" progress={inProgress} onComplete={vi.fn()} />
    );

    // Answer the first quiz incorrectly: it is now in its "submitted" state
    fireEvent.click(screen.getByText('A wrong'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();

    // Move to the second quiz
    rerender(
      <StepView course={course} stepId="step-b" progress={inProgress} onComplete={vi.fn()} />
    );

    // It starts fresh: nothing selected, nothing submitted
    expect(screen.getByText('Question step-b')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit Answer' })).toBeDisabled();
  });
});

describe('StepView: no debug output', () => {
  it('does not call console.log when rendering a checker step', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const course = makeCourse([
      {
        id: 'step-exe',
        title: { en: 'Link your wallet' },
        type: 'EXE',
        order: 0,
        exeContent: {
          instructions: { en: [] },
          checkerId: 'checker-1',
          checkerName: { en: 'Wallet linked' },
          checkerType: 'LINKED',
          checkerLinkedConfig: { network: 'STELLAR_TESTNET' },
        },
      },
    ]);

    try {
      render(
        <StepView
          course={course}
          stepId="step-exe"
          progress={inProgress}
          apiClient={makeClient()}
          linkedWallets={{ STELLAR_TESTNET: USER_ADDRESS }}
          onWalletLinked={vi.fn()}
          onComplete={vi.fn()}
        />
      );

      expect(screen.getByRole('button', { name: 'Verify & Complete' })).toBeEnabled();
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});
