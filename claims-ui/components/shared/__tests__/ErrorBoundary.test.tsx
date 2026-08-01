import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

// Mock component that throws an error
const ThrowingComponent = () => {
  throw new Error('Test error');
};

// Fallback component for testing
const FallbackComponent = () => <div data-testid="fallback">Fallback UI</div>;

describe('ErrorBoundary', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    (console.error as jest.Mock).mockRestore();
  });

  test('renders children when no error occurs', () => {
    render(<ErrorBoundary><div data-testid="normal">Normal Content</div></ErrorBoundary>);
    expect(screen.getByTestId('normal')).toBeInTheDocument();
  });

  test('renders fallback UI when child component throws', () => {
    render(
      <ErrorBoundary fallback={<FallbackComponent />}>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });

  test('calls componentDidCatch and logs error', () => {
    const spyOnComponentDidCatch = jest.spyOn(ErrorBoundary.prototype, 'componentDidCatch');
    
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    
    expect(spyOnComponentDidCatch).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Uncaught error'),
      expect.any(Error),
      expect.any(Object)
    );
  });

  test('resets error state when reset function is called', () => {
    const handleReset = jest.fn();
    
    render(
      <ErrorBoundary 
        fallback={<button onClick={handleReset}>Reset</button>}
      >
        <ThrowingComponent />
      </ErrorBoundary>
    );
    
    expect(screen.queryByTestId('fallback')).not.toBeInTheDocument();
    
    const resetButton = screen.getByRole('button', { name: /reset/i });
    act(() => {
      resetButton.click();
    });
    
    expect(handleReset).toHaveBeenCalled();
  });
});
