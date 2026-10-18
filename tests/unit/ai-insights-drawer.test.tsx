import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AiInsightsDrawer, mergeInsightHistory } from '@/app/components/AiInsightsDrawer';
import { AiInsightRecord } from '@/types/reports';

describe('AiInsightsDrawer Component', () => {
  const mockHistory: AiInsightRecord[] = [
    {
      id: 'ins-1',
      createdAt: '2026-08-28T12:00:00Z',
      triggeredByUserId: 'u-1',
      healthScore: 92,
      previousScore: 85,
      scoreDelta: 7,
      trendDirection: 'IMPROVED' as const,
      executiveSummary: 'Network health has improved (+7%).',
      resolvedIssues: [
        {
          id: 'res-1',
          category: 'RF_SIGNAL',
          severity: 'WARNING',
          title: 'AP Channel Utilization Normal',
          description: 'Channel congestion resolved.',
        },
      ],
      persistingIssues: [
        {
          id: 'per-1',
          category: 'RF_SIGNAL',
          severity: 'WARNING',
          title: 'Weak RSSI Device',
          description: 'Client device at -84 dBm',
          firstObservedAt: '2026-08-28T10:00:00Z',
          persistedAuditCount: 3,
        },
      ],
      newIssues: [
        {
          id: 'new-1',
          category: 'BANDWIDTH_BURST',
          severity: 'INFO',
          title: 'Port 4 Burst',
          description: 'Bandwidth surge 60 Mbps',
        },
      ],
      actionableSuggestions: [
        {
          id: 'sug-1',
          priority: 'HIGH',
          title: 'Enable Band Steering',
          action: 'Prefer 5GHz',
          expectedImpact: 'Improves speed',
        },
        {
          id: 'sug-2',
          priority: 'MEDIUM',
          title: 'Adjust Minimum RSSI',
          action: 'Set -78 dBm threshold',
          expectedImpact: 'Improves roaming',
        },
        {
          id: 'sug-3',
          priority: 'LOW',
          title: 'Routine Monitoring',
          action: 'Continue polling',
          expectedImpact: 'Maintains health',
        },
      ],
      metricsSnapshot: {},
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<AiInsightsDrawer isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('fetches and renders audit history, trajectory sparkline, switches tabs, and triggers new audit', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/admin/insights/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, history: mockHistory }),
        });
      }
      if (url.includes('/api/admin/insights/run') && opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            insight: {
              ...mockHistory[0],
              id: 'ins-2',
              healthScore: 96,
              scoreDelta: 4,
              executiveSummary: 'Latest audit run complete.',
            },
          }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    render(<AiInsightsDrawer isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText(/Retrieving AI audit trajectory/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Continuous AI & NLG Engine')).toBeInTheDocument();
    });

    expect(screen.getAllByText(/IMPROVED/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Weak RSSI Device')).toBeInTheDocument();

    // Switch to Resolved Tab
    fireEvent.click(screen.getByRole('button', { name: /Resolved \(1\)/i }));
    expect(screen.getByText(/AP Channel Utilization Normal/i)).toBeInTheDocument();

    // Switch to New Tab
    fireEvent.click(screen.getByRole('button', { name: /New \(1\)/i }));
    expect(screen.getByText(/Port 4 Burst/i)).toBeInTheDocument();

    // Switch to Suggestions Tab
    fireEvent.click(screen.getByRole('button', { name: /Suggestions/i }));
    expect(screen.getByText(/Enable Band Steering/i)).toBeInTheDocument();

    // Switch back to Persisting Tab
    fireEvent.click(screen.getByRole('button', { name: /Persisting \(1\)/i }));
    expect(screen.getByText('Weak RSSI Device')).toBeInTheDocument();

    // Trigger NLG audit button
    const triggerBtn = screen.getByRole('button', { name: /Trigger NLG Audit/i });
    fireEvent.click(triggerBtn);

    await waitFor(() => {
      expect(screen.getByText('Latest audit run complete.')).toBeInTheDocument();
    });

    // Close button
    const closeBtn = screen.getByRole('button', { name: /Close drawer/i });
    fireEvent.click(closeBtn);
  });

  it('renders empty baseline state when history is empty', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, history: [] }),
    });

    render(<AiInsightsDrawer isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/No Prior Audit Baseline in Memory/i)).toBeInTheDocument();
    });
  });

  it('renders error messages when history fetch or audit trigger fails with invalid JSON', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/admin/insights/history')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => {
            throw new Error('Invalid JSON');
          },
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    render(<AiInsightsDrawer isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch history \(500\)/i)).toBeInTheDocument();
    });
  });

  it('renders error messages when history fetch or audit trigger fails', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/admin/insights/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, history: mockHistory }),
        });
      }
      if (url.includes('/api/admin/insights/run') && opts?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'Inspection timeout' }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    render(<AiInsightsDrawer isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Continuous AI & NLG Engine')).toBeInTheDocument();
    });

    const triggerBtn = screen.getByRole('button', { name: /Trigger NLG Audit/i });
    fireEvent.click(triggerBtn);

    await waitFor(() => {
      expect(screen.getByText(/Inspection timeout/i)).toBeInTheDocument();
    });

    // Test run audit with invalid json response on error
    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/admin/insights/run') && opts?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          json: async () => {
            throw new Error('Invalid JSON');
          },
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    const triggerBtn2 = screen.getByRole('button', { name: /Trigger NLG Audit/i });
    fireEvent.click(triggerBtn2);
    await waitFor(() => {
      expect(screen.getByText(/Failed to execute deterministic NLG audit/i)).toBeInTheDocument();
    });
  });

  it('renders DEGRADED and INITIAL badges and empty tab notices properly', async () => {
    const degradedHistory = [
      {
        id: 'ins-deg',
        createdAt: '2026-08-28T12:00:00Z',
        healthScore: 65,
        previousScore: 80,
        scoreDelta: -15,
        trendDirection: 'DEGRADED',
        executiveSummary: 'Performance degraded.',
        resolvedIssues: [],
        persistingIssues: [],
        newIssues: [],
        actionableSuggestions: [],
        metricsSnapshot: {},
      },
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, history: degradedHistory }),
    });

    render(<AiInsightsDrawer isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/DEGRADED \(-15%\)/i)).toBeInTheDocument();
    });

    // Check empty persisting notice
    expect(screen.getByText(/No chronic or persisting issues detected/i)).toBeInTheDocument();

    // Check empty resolved notice
    fireEvent.click(screen.getByRole('button', { name: /Resolved \(0\)/i }));
    expect(screen.getByText(/No resolved issues in this specific cycle/i)).toBeInTheDocument();

    // Check empty new notice
    fireEvent.click(screen.getByRole('button', { name: /New \(0\)/i }));
    expect(screen.getByText(/No new anomalies surfaced/i)).toBeInTheDocument();

    // Check empty suggestions notice
    fireEvent.click(screen.getByRole('button', { name: /Suggestions \(0\)/i }));
    expect(screen.getByText(/No suggestions available/i)).toBeInTheDocument();
  });

  it('renders INITIAL and STABLE badges properly', async () => {
    const initialHistory = [
      {
        id: 'ins-init',
        createdAt: '2026-08-28T12:00:00Z',
        healthScore: 90,
        previousScore: null,
        scoreDelta: 0,
        trendDirection: 'INITIAL',
        executiveSummary: 'Initial baseline.',
        resolvedIssues: [],
        persistingIssues: [],
        newIssues: [],
        actionableSuggestions: [],
        metricsSnapshot: {},
      },
    ];

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, history: initialHistory }),
    });

    const { unmount } = render(<AiInsightsDrawer isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByText(/INITIAL/i).length).toBeGreaterThanOrEqual(1);
    });
    unmount();

    const stableHistory = [
      {
        id: 'ins-stab',
        createdAt: '2026-08-28T12:00:00Z',
        healthScore: 90,
        previousScore: 90,
        scoreDelta: 0,
        trendDirection: 'STABLE',
        executiveSummary: 'Stable.',
        resolvedIssues: [],
        persistingIssues: [],
        newIssues: [],
        actionableSuggestions: [],
        metricsSnapshot: {},
      },
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, history: stableHistory }),
    });

    render(<AiInsightsDrawer isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByText(/STABLE/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders 3-part comparative narration and processes feedback buttons and admin notes', async () => {
    const historyWithNarration = [
      {
        ...mockHistory[0],
        narration: {
          historyContext: 'Prior 5 inspection cycles maintained 95% average score.',
          deltaChanges: '+2 IoT smart devices connected on VLAN 20.',
          currentStatus: 'Optimal posture across all physical nodes.',
          fullNarrative: 'Full narrative content here.',
        },
      },
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, history: historyWithNarration }),
    });

    render(<AiInsightsDrawer isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/AI Audit Comparative Narration/i)).toBeInTheDocument();
      expect(screen.getByText(/HOW THINGS HAVE BEEN/i)).toBeInTheDocument();
      expect(screen.getByText(/Prior 5 inspection cycles maintained 95% average score./i)).toBeInTheDocument();
      expect(screen.getByText(/WHAT HAS CHANGED/i)).toBeInTheDocument();
      expect(screen.getByText(/\+2 IoT smart devices connected on VLAN 20./i)).toBeInTheDocument();
      expect(screen.getByText(/CURRENT OPERATIONAL POSTURE/i)).toBeInTheDocument();
      expect(screen.getByText(/Optimal posture across all physical nodes./i)).toBeInTheDocument();
    });

    // Test feedback buttons on persisting issue
    const iotFeedbackBtn = screen.getByRole('button', { name: /Expected IoT/i });
    fireEvent.click(iotFeedbackBtn);
    expect(screen.getByText(/✓ Tuned: EXPECTED_IOT/i)).toBeInTheDocument();
    expect(screen.getByText(/Acknowledged as Expected IoT Segregation/i)).toBeInTheDocument();

    // Switch to New tab and test Helpful button
    fireEvent.click(screen.getByRole('button', { name: /New \(1\)/i }));
    const helpfulBtn = screen.getByRole('button', { name: /Helpful/i });
    fireEvent.click(helpfulBtn);
    expect(screen.getByText(/✓ Tuned: HELPFUL/i)).toBeInTheDocument();

    // Submit Admin Tuning note
    const noteInput = screen.getByPlaceholderText(/VLAN 20 has 2.4 GHz-only smart home gear/i);
    fireEvent.change(noteInput, { target: { value: 'VLAN 20 is dedicated to smart home IoT devices.' } });
    const saveBtn = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(saveBtn);
    expect(screen.getByText(/Note kept locally for this session only/i)).toBeInTheDocument();
    expect(screen.queryByText(/Tuning Context Applied/i)).not.toBeInTheDocument();

    // Test form submit with empty value (does nothing)
    const form = saveBtn.closest('form')!;
    fireEvent.change(noteInput, { target: { value: '   ' } });
    fireEvent.submit(form);

    // Test unmount
    const { unmount } = render(
      <AiInsightsDrawer
        isOpen={true}
        onClose={vi.fn()}
      />
    );
    unmount();
  });

  it('handles suppress button and new issue IoT tagging', async () => {
    const historyData = [
      {
        ...mockHistory[0],
        persistingIssues: [
          {
            id: 'per-suppress',
            category: 'RF_SIGNAL',
            severity: 'WARNING',
            title: 'Sticky Client',
            description: 'Needs suppress',
            firstObservedAt: '2026-08-28T10:00:00Z',
            persistedAuditCount: 2,
          },
        ],
        newIssues: [
          {
            id: 'new-iot-tag',
            category: 'CHANNEL_CONGESTION',
            severity: 'WARNING',
            title: 'IoT Band Usage',
            description: 'IoT on 2.4G',
          },
        ],
      },
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, history: historyData }),
    });

    render(<AiInsightsDrawer isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Sticky Client')).toBeInTheDocument();
    });

    // Test Suppress button
    const suppressBtn = screen.getByRole('button', { name: /Suppress/i });
    fireEvent.click(suppressBtn);
    // Feedback is session-local only; the toast must not claim future audits are tuned
    expect(screen.getByText(/Suppressed locally for this session only/i)).toBeInTheDocument();
    expect(screen.queryByText(/suppressed for future audits/i)).not.toBeInTheDocument();

    // Switch to New tab and test Expected IoT button
    fireEvent.click(screen.getByRole('button', { name: /New \(1\)/i }));
    const expectedIotBtn = screen.getByRole('button', { name: /Expected IoT/i });
    fireEvent.click(expectedIotBtn);
    expect(screen.getByText(/✓ Tuned: EXPECTED_IOT/i)).toBeInTheDocument();
  });

  it('suppresses a new issue locally for the session', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, history: mockHistory }),
    });

    render(<AiInsightsDrawer isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('Weak RSSI Device')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /New \(1\)/i }));
    fireEvent.click(screen.getByRole('button', { name: /Suppress/i }));
    expect(screen.getByText(/✓ Tuned: SUPPRESSED/i)).toBeInTheDocument();
    expect(screen.getByText(/Suppressed locally for this session only/i)).toBeInTheDocument();
  });

  it('triggers and clears feedback toast timeout callbacks', async () => {
    vi.useFakeTimers();

    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/admin/insights/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, history: mockHistory }),
        });
      }
      if (url.includes('/api/admin/insights/run') && opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            insight: { ...mockHistory[0], id: 'ins-new-timer' },
          }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    render(<AiInsightsDrawer isOpen={true} onClose={vi.fn()} />);

    await vi.runAllTimersAsync();

    const triggerBtn = screen.getByRole('button', { name: /Trigger NLG Audit/i });
    fireEvent.click(triggerBtn);

    await vi.runAllTimersAsync();

    const iotBtn = screen.getByRole('button', { name: /Expected IoT/i });
    fireEvent.click(iotBtn);

    vi.advanceTimersByTime(4000);

    vi.useRealTimers();
  });

  it('handles DeepSeek LLM Agent audit execution and renders Chain-of-Thought deliberation', async () => {
    const deepSeekHistory = [
      {
        ...mockHistory[0],
        engineType: 'DEEPSEEK_AGENT',
        llmModel: 'deepseek-r1:7b',
        thinkingProcess: 'Analyzing 2.4 GHz channel occupancy... IoT devices on VLAN 20 are properly segregated.',
      },
    ];

    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/admin/insights/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, history: deepSeekHistory }),
        });
      }
      if (url.includes('/api/admin/insights/agent') && opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            insight: {
              ...deepSeekHistory[0],
              id: 'ins-deepseek-new',
              executiveSummary: 'DeepSeek-R1 confirmed optimal spectrum allocation.',
            },
          }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    render(<AiInsightsDrawer isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Neural LLM Agent \(deepseek-r1:7b\)/i)).toBeInTheDocument();
      expect(screen.getByText(/DeepSeek-R1 Chain-of-Thought Reasoning Deliberation/i)).toBeInTheDocument();
    });

    // Expand Chain of Thought
    const cotBtn = screen.getByText(/DeepSeek-R1 Chain-of-Thought Reasoning Deliberation/i);
    fireEvent.click(cotBtn);
    expect(screen.getByText(/Analyzing 2.4 GHz channel occupancy/i)).toBeInTheDocument();

    // Trigger DeepSeek Agent run
    const agentBtn = screen.getByRole('button', { name: /Run DeepSeek Agent/i });
    fireEvent.click(agentBtn);

    await waitFor(() => {
      expect(screen.getByText(/DeepSeek-R1 Neural Agent completed real generative reasoning!/i)).toBeInTheDocument();
    });
  });

  const makeRecord = (id: string, createdAt: string, healthScore: number): AiInsightRecord => ({
    ...mockHistory[0],
    id,
    createdAt,
    healthScore,
    executiveSummary: `Summary ${id}`,
    narration: undefined,
  });

  it('mergeInsightHistory dedupes by id (first list wins) and sorts newest first', () => {
    const older = makeRecord('a', '2026-08-01T00:00:00Z', 70);
    const newer = makeRecord('b', '2026-08-02T00:00:00Z', 80);
    const newerDuplicate = { ...newer, healthScore: 1 };
    const invalidDate = makeRecord('c', 'not-a-date', 50);

    const merged = mergeInsightHistory([older, newer], [newerDuplicate, invalidDate]);
    expect(merged.map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(merged[0].healthScore).toBe(80);
  });

  it('keeps the newest audit as latest when a reopen fetch no longer includes an old local record', async () => {
    const oldRecord = makeRecord('old', '2026-08-01T00:00:00Z', 41);
    const newRecord = makeRecord('new', '2026-08-03T00:00:00Z', 88);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ history: [oldRecord] }),
    });
    const { rerender } = render(<AiInsightsDrawer isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('Summary old')).toBeInTheDocument();
    });

    rerender(<AiInsightsDrawer isOpen={false} onClose={vi.fn()} />);

    // Server's top-N window has moved on: only newer records are returned
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ history: [newRecord] }),
    });
    rerender(<AiInsightsDrawer isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Summary new')).toBeInTheDocument();
    });
    expect(screen.queryByText('Summary old')).not.toBeInTheDocument();
    expect(screen.getByText(/PAST 2 AUDITS/i)).toBeInTheDocument();
  });

  it('clears a stale error and shows loading again when reopened', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'History store offline' }),
    });
    const { rerender } = render(<AiInsightsDrawer isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/History store offline/i)).toBeInTheDocument();
    });

    rerender(<AiInsightsDrawer isOpen={false} onClose={vi.fn()} />);
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    rerender(<AiInsightsDrawer isOpen={true} onClose={vi.fn()} />);

    expect(screen.queryByText(/History store offline/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Retrieving AI audit trajectory/i)).toBeInTheDocument();
  });

  it('auto-dismisses the background completion toast and clears its timer on close', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ history: [] }),
    });
    const completed = {
      status: 'completed' as const,
      engineType: 'NLG_ALGORITHMIC' as const,
      startTime: 1,
      result: makeRecord('bg-done', '2026-08-04T00:00:00Z', 90),
    };

    const { rerender } = render(<AiInsightsDrawer isOpen={true} onClose={vi.fn()} backgroundAudit={completed} />);
    expect(screen.getByText(/Deterministic NLG audit completed/i)).toBeInTheDocument();

    // Closing before the timeout cancels it; reopening shows the toast again
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    rerender(<AiInsightsDrawer isOpen={false} onClose={vi.fn()} backgroundAudit={completed} />);
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    rerender(<AiInsightsDrawer isOpen={true} onClose={vi.fn()} backgroundAudit={completed} />);
    expect(screen.getByText(/Deterministic NLG audit completed/i)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText(/Deterministic NLG audit completed/i)).not.toBeInTheDocument();
  });

  it('calls onTriggerNlgAudit and onTriggerAgentAudit when provided as props', async () => {
    const mockTriggerNlg = vi.fn();
    const mockTriggerAgent = vi.fn();
    const mockClose = vi.fn();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ history: mockHistory }),
    });

    const { rerender } = render(
      <AiInsightsDrawer
        isOpen={true}
        onClose={mockClose}
        onTriggerNlgAudit={mockTriggerNlg}
        onTriggerAgentAudit={mockTriggerAgent}
        backgroundAudit={{
          status: 'idle',
          engineType: 'DEEPSEEK_AGENT',
          startTime: 0,
        }}
      />
    );

    // Trigger buttons call props when idle
    const nlgBtn = screen.getByRole('button', { name: /Trigger NLG Audit/i });
    fireEvent.click(nlgBtn);
    expect(mockTriggerNlg).toHaveBeenCalled();

    const agentBtn = screen.getByRole('button', { name: /Run DeepSeek Agent/i });
    fireEvent.click(agentBtn);
    expect(mockTriggerAgent).toHaveBeenCalled();

    // Rerender with running background audit
    rerender(
      <AiInsightsDrawer
        isOpen={true}
        onClose={mockClose}
        onTriggerNlgAudit={mockTriggerNlg}
        onTriggerAgentAudit={mockTriggerAgent}
        backgroundAudit={{
          status: 'running',
          engineType: 'DEEPSEEK_AGENT',
          startTime: Date.now(),
        }}
      />
    );

    // Click Push to Background button while running
    const pushBgBtn = screen.getByRole('button', { name: /Push to Background/i });
    fireEvent.click(pushBgBtn);
    expect(mockClose).toHaveBeenCalled();

    // Rerender with background completed state
    rerender(
      <AiInsightsDrawer
        isOpen={true}
        onClose={mockClose}
        backgroundAudit={{
          status: 'completed',
          engineType: 'DEEPSEEK_AGENT',
          startTime: Date.now(),
          result: {
            ...mockHistory[0],
            id: 'ins-bg-prop-done',
            healthScore: 98,
          },
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/98/)).toBeInTheDocument();
    });

    // Rerender with background error state
    rerender(
      <AiInsightsDrawer
        isOpen={true}
        onClose={mockClose}
        backgroundAudit={{
          status: 'error',
          engineType: 'DEEPSEEK_AGENT',
          startTime: Date.now(),
          error: 'Remote engine timeout',
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Remote engine timeout/i)).toBeInTheDocument();
    });
  });
});
