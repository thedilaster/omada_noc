import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HardwarePoeView from '@/app/components/HardwarePoeView';
import { PoeDeviceBudget, OmadaDeviceItem } from '@/types/omada';

describe('HardwarePoeView Component', () => {
  it('renders honest empty status when no data is provided', () => {
    render(<HardwarePoeView />);
    expect(screen.getByText(/PoE Switch Power Budget & Headroom/i)).toBeInTheDocument();
    expect(screen.getByText(/No PoE switch telemetry reporting on this site/i)).toBeInTheDocument();
    expect(screen.getByText(/No physical hardware nodes discovered on this site/i)).toBeInTheDocument();
  });

  it('renders custom PoE switch telemetry and hardware nodes', () => {
    const customPoe: PoeDeviceBudget[] = [
      {
        mac: 'AA-11-22-33-44-55',
        name: 'Custom Core PoE Switch',
        model: 'TL-SG3428MP',
        ip: '10.0.0.10',
        poeRemain: 280.5,
        totalPoePower: 384,
        poePowerUsed: 103.5,
        clientNum: 16,
        cpuUtil: 15,
        memUtil: 48,
        uptime: 50000,
        status: 14,
      },
    ];

    const customNodes: OmadaDeviceItem[] = [
      {
        mac: 'AA-11-22-33-44-55',
        name: 'Custom Core PoE Switch',
        model: 'TL-SG3428MP',
        type: 'switch',
        ip: '10.0.0.10',
        cpuUtil: 15,
        memUtil: 48,
        uptime: 50000,
        firmwareVersion: '1.0.0 Build 20260101',
        status: 14,
        needUpgrade: false,
      },
    ];

    render(<HardwarePoeView poeDevices={customPoe} devices={customNodes} siteName="HQ Site" />);
    expect(screen.getByText(/HQ Site/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Custom Core PoE Switch/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/280.5W/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/103.5W/i)).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it('derives PoE switch status pills from device status', () => {
    const base: PoeDeviceBudget = {
      mac: 'AA-11-22-33-44-01',
      name: 'Switch A',
      model: 'TL-SG2210MP',
      ip: '10.0.0.11',
      poeRemain: 100,
      totalPoePower: 150,
      clientNum: 3,
      status: 14,
    };
    const poeDevices = [
      base,
      { ...base, mac: 'AA-11-22-33-44-02', name: 'Switch B', status: 0 },
      { ...base, mac: 'AA-11-22-33-44-03', name: 'Switch C', status: undefined as unknown as number },
    ];

    render(<HardwarePoeView poeDevices={poeDevices} />);
    expect(screen.getAllByText('Online')).toHaveLength(1);
    expect(screen.getAllByText('Offline')).toHaveLength(1);
    expect(screen.getAllByText('Unknown')).toHaveLength(1);
  });
});
