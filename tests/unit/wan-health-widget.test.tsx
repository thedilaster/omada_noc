import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WanHealthWidget from '@/app/components/WanHealthWidget';
import { WanStatusInfo } from '@/types/omada';

describe('WanHealthWidget Component', () => {
  it('renders honest unavailable status when wanStatus is undefined', () => {
    render(<WanHealthWidget />);
    expect(screen.getByText(/WAN Gateway Telemetry Unavailable/i)).toBeInTheDocument();
    expect(screen.getAllByText(/UNCONFIGURED/i).length).toBeGreaterThanOrEqual(1);
  });

  it('toggles expand/collapse details and renders backup WAN', () => {
    const customWan: WanStatusInfo = {
      gatewayModel: 'ER7206 Custom',
      primaryWan: {
        port: 1,
        name: 'Fiber WAN 1',
        type: 'wan',
        online: true,
        ip: '203.0.113.5',
        gateway: '203.0.113.1',
        dns: ['1.1.1.1', '8.8.8.8'],
        proto: 'Static',
        latencyMs: 12,
        packetLossPercent: 0.0,
        rxRate: 5000000,
        txRate: 1000000,
        uptime: 99999,
        providerName: 'Metronet Fiber',
        isPrimary: true,
      },
      backupWan: {
        port: 2,
        name: 'LTE Backup 2',
        type: 'wan/lan',
        online: true,
        ip: '192.168.8.50',
        gateway: '192.168.8.1',
        dns: ['9.9.9.9'],
        proto: 'DHCP',
        latencyMs: 45,
        packetLossPercent: 0.0,
        rxRate: 100,
        txRate: 50,
        uptime: 99999,
        providerName: 'Verizon LTE',
        isPrimary: false,
      },
      dualWanMode: 'Failover',
      overallUptimePercent: 99.99,
    };

    render(<WanHealthWidget wanStatus={customWan} />);
    expect(screen.getByText(/Metronet Fiber/i)).toBeInTheDocument();
    expect(screen.getByText(/12ms Ping/i)).toBeInTheDocument();

    // Click to expand
    const expandBtn = screen.getByRole('button', { name: /WAN Details/i });
    fireEvent.click(expandBtn);

    expect(screen.getByText('PRIMARY ROUTE')).toBeInTheDocument();
    expect(screen.getByText('HOT STANDBY')).toBeInTheDocument();
    expect(screen.getByText(/Fiber WAN 1/i)).toBeInTheDocument();
    expect(screen.getByText(/LTE Backup 2/i)).toBeInTheDocument();

    // Click to collapse
    fireEvent.click(screen.getByRole('button', { name: /Hide Details/i }));
    expect(screen.queryByText('PRIMARY ROUTE')).not.toBeInTheDocument();
  });

  const offlineWan = (): WanStatusInfo => ({
    gatewayModel: 'ER605',
    primaryWan: {
      port: 1,
      name: 'WAN1',
      type: 'wan',
      online: false,
      ip: '0.0.0.0',
      gateway: '',
      dns: undefined as unknown as string[],
      proto: 'DHCP',
      latencyMs: undefined as unknown as number,
      packetLossPercent: undefined as unknown as number,
      rxRate: undefined as unknown as number,
      txRate: undefined as unknown as number,
      uptime: 0,
    },
    backupWan: {
      port: 2,
      name: 'WAN2',
      type: 'wan/lan',
      online: false,
      ip: '0.0.0.0',
      gateway: '',
      dns: [],
      proto: 'DHCP',
      latencyMs: undefined as unknown as number,
      packetLossPercent: 0,
      rxRate: 0,
      txRate: 0,
      uptime: 0,
    },
    dualWanMode: 'Failover',
    overallUptimePercent: 0,
  });

  it('shows OFFLINE and dashes instead of invented metrics when the WAN is down', () => {
    render(<WanHealthWidget wanStatus={offlineWan()} />);
    expect(screen.getByText('OFFLINE')).toBeInTheDocument();
    expect(screen.queryByText('ONLINE')).not.toBeInTheDocument();
    expect(screen.getByText('— Ping')).toBeInTheDocument();
    expect(screen.getByText('↓ —')).toBeInTheDocument();
    expect(screen.getByText('↑ —')).toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /WAN Details/i }));
    expect(screen.getByText('STANDBY OFFLINE')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });

  it('shows UNKNOWN when the controller does not report link state and keeps zero rates', () => {
    const wan = offlineWan();
    wan.primaryWan = {
      ...wan.primaryWan,
      online: undefined as unknown as boolean,
      latencyMs: 30,
      packetLossPercent: 1.5,
      rxRate: 0,
      txRate: 2048,
    };
    render(<WanHealthWidget wanStatus={wan} />);
    expect(screen.getByText('UNKNOWN')).toBeInTheDocument();
    expect(screen.getByText('30ms Ping')).toBeInTheDocument();
    expect(screen.getByText('1.5%')).toBeInTheDocument();
    expect(screen.getByText('↓ 0 B/s')).toBeInTheDocument();
    expect(screen.getByText('↑ 2 KB/s')).toBeInTheDocument();
  });
});
