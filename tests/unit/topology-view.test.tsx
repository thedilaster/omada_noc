import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TopologyView from '@/app/components/TopologyView';
import { OmadaTopologyNode } from '@/types/omada';

describe('TopologyView Component', () => {
  it('renders honest unavailable status when no data is passed', () => {
    render(<TopologyView />);
    expect(screen.getByText(/Physical Topology Data Unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/The Omada Controller did not return an active link-layer topology/i)).toBeInTheDocument();
  });

  it('renders custom topology nodes and opens/closes the node inspection drawer', () => {
    const customTopology: OmadaTopologyNode[] = [
      {
        type: 'gateway',
        name: 'Custom Gateway X1',
        mac: 'AA-BB-CC-DD-EE-01',
        model: 'ER8411',
        ip: '10.0.0.1',
        clientCount: 0,
        successors: [
          {
            type: 'switch',
            name: 'Core Switch S1',
            mac: 'AA-BB-CC-DD-EE-02',
            model: 'SX3008F',
            ip: '10.0.0.2',
            clientCount: 10,
          },
          {
            type: 'ap',
            name: 'Outdoor AP 1',
            mac: 'AA-BB-CC-DD-EE-03',
            model: 'EAP650-Outdoor',
            ip: '10.0.0.3',
            clientCount: 25,
          },
        ],
      },
    ];

    render(<TopologyView topology={customTopology} siteName="Custom Site" />);
    expect(screen.getByText(/Custom Site/i)).toBeInTheDocument();
    expect(screen.getByText(/Custom Gateway X1/i)).toBeInTheDocument();
    expect(screen.getByText(/Core Switch S1/i)).toBeInTheDocument();
    expect(screen.getByText(/Outdoor AP 1/i)).toBeInTheDocument();

    // Click node to open drawer
    fireEvent.click(screen.getByText(/Custom Gateway X1/i));
    expect(screen.getByText(/Focused Node Telemetry/i)).toBeInTheDocument();
    expect(screen.getAllByText(/10.0.0.1/i).length).toBeGreaterThanOrEqual(2);

    // Close drawer
    const closeBtn = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeBtn);
    expect(screen.queryByText(/Focused Node Telemetry/i)).not.toBeInTheDocument();
  });

  it('renders unknown node type using fallback styling', () => {
    const customTopology: OmadaTopologyNode[] = [
      {
        type: 'server',
        name: 'Custom NAS Server',
        mac: 'AA-BB-CC-DD-EE-99',
        model: 'Custom Node',
        ip: '10.0.0.99',
        clientCount: 0,
      },
    ];

    render(<TopologyView topology={customTopology} siteName="Custom Site" />);
    expect(screen.getByText(/Custom NAS Server/i)).toBeInTheDocument();
  });

  it('derives node status badges from status / statusCategory instead of always showing Online', () => {
    const devices = [
      { mac: '00:11', name: 'Gateway ER7206', type: 'gateway', model: 'ER7206', ip: '192.168.1.1', status: 14 },
      { mac: '00:22', name: 'Dead Switch', type: 'switch', model: 'SG2218P', ip: '192.168.1.2', status: 0 },
      { mac: '00:33', name: 'Mesh AP', type: 'ap', model: 'EAP670', ip: '192.168.1.3', status: 0, statusCategory: 1 },
    ];

    render(<TopologyView devices={devices as any} />);
    expect(screen.getAllByText('Online')).toHaveLength(2);
    expect(screen.getAllByText('Offline')).toHaveLength(1);
  });

  it('shows Unknown status and does not crash for custom nodes without a type or status', () => {
    const customTopology = [
      { name: 'Mystery Node', mac: 'AA-BB-CC-DD-EE-77', model: 'Unknown Model' },
      { type: 'server', name: 'Offline NAS', mac: 'AA-BB-CC-DD-EE-78', model: 'DS920+', status: 0 },
    ] as unknown as OmadaTopologyNode[];

    render(<TopologyView topology={customTopology} />);
    expect(screen.getByText('Mystery Node')).toBeInTheDocument();
    expect(screen.getByText('unknown')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.queryByText('Online')).not.toBeInTheDocument();
  });

  it('renders edge switches in the distribution tier with PoE allocation from device data', () => {
    const devices = [
      { mac: '00:11', name: 'Gateway', type: 'gateway', model: 'ER7206', ip: '192.168.1.1', status: 14 },
      { mac: '00:22', name: 'Core Switch', type: 'switch', model: 'SG3428', ip: '192.168.1.2', status: 14, totalPoePower: 100, poeRemain: 60 },
      { mac: '00:44', name: 'Barn Switch', type: 'switch', model: 'SG2210MP', ip: '192.168.1.4', status: 14 },
      { mac: '00:33', name: 'Barn AP', type: 'ap', model: 'EAP610', ip: '192.168.1.3', status: 14, clientNum: 4 },
    ];

    render(<TopologyView devices={devices as any} />);
    expect(screen.getByText(/Tier 3: Distribution & Outbuilding PoE Switches \(1 Managed Nodes\)/i)).toBeInTheDocument();
    expect(screen.getByText('Barn Switch')).toBeInTheDocument();
    expect(screen.getByText(/802.3at PoE Power & Data Feeds/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Core Switch'));
    expect(screen.getByText('40.0W')).toBeInTheDocument();
  });

  it('filters nodes by layer buttons (gateway, switch, ap, all)', () => {
    const devices = [
      { mac: '00:11', name: 'Gateway ER7206', type: 'gateway', model: 'ER7206', ip: '192.168.1.1', status: 14 },
      { mac: '00:22', name: 'Backbone SG2218P', type: 'switch', model: 'SG2218P', ip: '192.168.1.2', status: 14 },
      { mac: '00:33', name: 'Main Center EAP670', type: 'ap', model: 'EAP670', ip: '192.168.1.3', status: 14 },
    ];

    render(<TopologyView devices={devices as any} />);

    // Filter to Gateway
    fireEvent.click(screen.getByRole('button', { name: /gateway/i }));
    expect(screen.getByText(/Gateway ER7206/i)).toBeInTheDocument();
    expect(screen.queryByText(/Main Center EAP670/i)).not.toBeInTheDocument();

    // Filter to Switches
    fireEvent.click(screen.getByRole('button', { name: /switches/i }));
    expect(screen.getByText(/Backbone SG2218P/i)).toBeInTheDocument();
    expect(screen.queryByText(/Gateway ER7206/i)).not.toBeInTheDocument();

    // Filter to Access Points
    fireEvent.click(screen.getByRole('button', { name: /access points/i }));
    expect(screen.getByText(/Main Center EAP670/i)).toBeInTheDocument();
    expect(screen.queryByText(/Backbone SG2218P/i)).not.toBeInTheDocument();

    // Filter back to All Tiers
    fireEvent.click(screen.getByRole('button', { name: /all tiers/i }));
    expect(screen.getByText(/Gateway ER7206/i)).toBeInTheDocument();
    expect(screen.getByText(/Backbone SG2218P/i)).toBeInTheDocument();
    expect(screen.getByText(/Main Center EAP670/i)).toBeInTheDocument();
  });
});
