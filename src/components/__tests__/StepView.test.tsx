import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
    getWalletNetwork: vi.fn().mockResolvedValue(null),
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

describe('StepView: CERTIFICATE step', () => {
  const certificateCourse = () =>
    makeCourse([
      {
        id: 'step-cert',
        title: { en: 'Your certificate' },
        type: 'CERTIFICATE',
        order: 0,
      },
    ]);

  it('renders a minimal step with the standard completion button', async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    render(
      <StepView
        course={certificateCourse()}
        stepId="step-cert"
        progress={inProgress}
        onComplete={onComplete}
      />
    );

    const content = document.querySelector('.venalabs-step-view__content')!;
    expect(within(content as HTMLElement).getByText('Your certificate')).toBeInTheDocument();
    expect(
      screen.getByText('You have reached the end of this course. Complete this step to finish it.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/Unknown step type/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark as complete' }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('step-cert', undefined));
  });

  it('lets the user finish the course once the step is completed', () => {
    const onFinishCourse = vi.fn();
    const completed: VenalabsProgress = {
      ...inProgress,
      status: 'COMPLETED',
      stepProgress: [{ stepId: 'step-cert', status: 'COMPLETED' }],
    };
    render(
      <StepView
        course={certificateCourse()}
        stepId="step-cert"
        progress={completed}
        onComplete={vi.fn()}
        onFinishCourse={onFinishCourse}
      />
    );

    expect(screen.queryByRole('button', { name: 'Mark as complete' })).not.toBeInTheDocument();
    expect(screen.getByText('Step completed!')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Finish Course' }));
    expect(onFinishCourse).toHaveBeenCalledTimes(1);
  });
});

describe('StepView: unknown step type', () => {
  it('shows a neutral message without crashing', () => {
    const course = makeCourse([
      {
        id: 'step-x',
        title: { en: 'Something new' },
        type: 'SURVEY' as never,
        order: 0,
      },
    ]);

    render(<StepView course={course} stepId="step-x" progress={inProgress} onComplete={vi.fn()} />);

    expect(
      screen.getByText('This step type is not supported in this SDK version.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/SURVEY/)).not.toBeInTheDocument();
  });
});

describe('StepView: checkers the SDK does not handle', () => {
  const exeCourse = (exeContent: Record<string, unknown>) =>
    makeCourse([
      {
        id: 'step-exe',
        title: { en: 'Do something on-chain' },
        type: 'EXE',
        order: 0,
        exeContent: {
          instructions: { en: [] },
          checkerId: 'checker-1',
          checkerName: { en: 'On-chain action' },
          ...exeContent,
        } as never,
      },
    ]);

  const renderExe = (exeContent: Record<string, unknown>) =>
    render(
      <StepView
        course={exeCourse(exeContent)}
        stepId="step-exe"
        progress={inProgress}
        apiClient={makeClient()}
        linkedWallets={{}}
        onWalletLinked={vi.fn()}
        onComplete={vi.fn()}
      />
    );

  const expectNoStellarWalletAction = () => {
    expect(document.querySelector('.venalabs-wallet-linker')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect Wallet' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Link Wallet' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify & Complete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as complete' })).not.toBeInTheDocument();
  };

  it('says that a HYPERCORE checker is not supported in this SDK version', () => {
    renderExe({
      checkerType: 'HYPERCORE',
      checkerHypercoreConfig: { network: 'HYPERLIQUID_MAINNET', action: 'TRADED' },
    });

    expect(
      screen.getByText('This verification type (HYPERCORE) is not supported in this SDK version.')
    ).toBeInTheDocument();
    expectNoStellarWalletAction();
  });

  it('says that a checker on a non-Stellar network is not supported, without offering a Stellar wallet', () => {
    mocks.wallet.current.stellarAddress = null;
    mocks.wallet.current.isConnected = false;
    renderExe({
      checkerType: 'BALANCE',
      checkerBalanceConfig: { network: 'ARBITRUM', tokenCode: 'USDC' },
    });

    expect(
      screen.getByText(
        'This verification targets a network (ARBITRUM) that is not supported in this SDK version.'
      )
    ).toBeInTheDocument();
    expectNoStellarWalletAction();
  });

  it('applies the same rule to an NFT mint on a non-Stellar network', () => {
    renderExe({
      checkerType: 'NFT_MINT',
      checkerNftMintConfig: { network: 'HYPERLIQUID_MAINNET', contractAddress: '0xabc' },
    });

    expect(
      screen.getByText(
        'This verification targets a network (HYPERLIQUID_MAINNET) that is not supported in this SDK version.'
      )
    ).toBeInTheDocument();
    expectNoStellarWalletAction();
    expect(screen.queryByRole('button', { name: 'Mint NFT' })).not.toBeInTheDocument();
  });

  it('still shows a completed step as completed', () => {
    const completed: VenalabsProgress = {
      ...inProgress,
      stepProgress: [{ stepId: 'step-exe', status: 'COMPLETED' }],
    };
    render(
      <StepView
        course={exeCourse({ checkerType: 'HYPERCORE' })}
        stepId="step-exe"
        progress={completed}
        apiClient={makeClient()}
        linkedWallets={{}}
        onWalletLinked={vi.fn()}
        onComplete={vi.fn()}
      />
    );

    expect(screen.getByText('Step verified and completed!')).toBeInTheDocument();
    expect(screen.queryByText(/not supported in this SDK version/)).not.toBeInTheDocument();
  });
});
