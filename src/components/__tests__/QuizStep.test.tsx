import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StepContent } from '../ui/StepContent';
import type { VenalabsCourseStep, VenalabsQuizContent } from '../../types';

function quizStep(quizContent: Partial<VenalabsQuizContent>): VenalabsCourseStep {
  return {
    id: 'step-quiz',
    title: { en: 'Quiz' },
    type: 'QUIZ',
    order: 0,
    quizContent: {
      question: { en: 'Which network settles in about five seconds?' },
      options: [
        { text: { en: 'Option A' } },
        { text: { en: 'Option B' } },
        { text: { en: 'Option C' } },
      ],
      ...quizContent,
    } as VenalabsQuizContent,
  };
}

function answer(option: string) {
  fireEvent.click(screen.getByText(option));
  fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));
}

describe('Quiz step: correctOptionIndex provided by the API', () => {
  it('accepts the option designated by the API', () => {
    const onComplete = vi.fn();
    render(
      <StepContent
        step={quizStep({ correctOptionIndex: 2 })}
        onComplete={onComplete}
        isCompleted={false}
      />
    );

    answer('Option C');

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({ selectedIndex: 2, correct: true });
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
  });

  it('rejects any other option and lets the user try again', () => {
    const onComplete = vi.fn();
    render(
      <StepContent
        step={quizStep({ correctOptionIndex: 2 })}
        onComplete={onComplete}
        isCompleted={false}
      />
    );

    answer('Option A');

    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    answer('Option B');

    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
  });

  it('shows the explanation after an answer', () => {
    render(
      <StepContent
        step={quizStep({ correctOptionIndex: 1, explanation: { en: 'Because B.' } })}
        onComplete={vi.fn()}
        isCompleted={false}
      />
    );

    answer('Option B');

    expect(screen.getByText('Because B.')).toBeInTheDocument();
  });
});

describe('Quiz step: correctOptionIndex missing from the API response', () => {
  it('renders and can be answered without crashing', () => {
    const onComplete = vi.fn();
    const step = quizStep({});
    expect(step.quizContent).not.toHaveProperty('correctOptionIndex');

    expect(() =>
      render(<StepContent step={step} onComplete={onComplete} isCompleted={false} />)
    ).not.toThrow();

    expect(screen.getByText('Which network settles in about five seconds?')).toBeInTheDocument();
    expect(() => answer('Option C')).not.toThrow();
    // Still interactive after the answer
    expect(screen.getByText('Option A')).toBeInTheDocument();
  });

  it('renders a completed quiz without crashing', () => {
    expect(() =>
      render(<StepContent step={quizStep({})} onComplete={vi.fn()} isCompleted={true} />)
    ).not.toThrow();
    expect(screen.getByText('Option A')).toBeInTheDocument();
  });

  it('does not crash when the quiz content is missing altogether', () => {
    const step: VenalabsCourseStep = {
      id: 'step-quiz',
      title: { en: 'Quiz' },
      type: 'QUIZ',
      order: 0,
    };

    expect(() =>
      render(<StepContent step={step} onComplete={vi.fn()} isCompleted={false} />)
    ).not.toThrow();
  });
});
