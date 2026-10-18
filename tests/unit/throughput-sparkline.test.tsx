import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ThroughputSparkline from '@/app/components/ThroughputSparkline';

describe('ThroughputSparkline Component', () => {
  it('renders SVG sparkline with provided history data and peak rate', () => {
    const history = [1024, 2048, 4096, 8192, 16384];
    render(<ThroughputSparkline history={history} currentRate={16384} />);

    expect(screen.getByText(/Peak:/i)).toBeInTheDocument();
    expect(screen.getByText(/16 KB\/s/i)).toBeInTheDocument();
  });

  it('scales the ping animation around the dot itself (transform-box: fill-box)', () => {
    const { container } = render(<ThroughputSparkline history={[1, 2, 3]} currentRate={3} />);
    const dot = container.querySelector('circle');
    expect(dot).toHaveClass('animate-ping', 'origin-center', '[transform-box:fill-box]');
  });

  it('handles empty history gracefully and renders default path', () => {
    render(<ThroughputSparkline history={[]} currentRate={0} />);
    expect(screen.getByText(/Peak:/i)).toBeInTheDocument();
  });
});
