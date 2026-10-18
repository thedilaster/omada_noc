import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ClientInspectorModal from '@/app/components/ClientInspectorModal';
import { OmadaClientDevice, OmadaLanNetwork } from '@/types/omada';

describe('ClientInspectorModal Component', () => {
  const mockNetworks: OmadaLanNetwork[] = [
    { id: '1', name: 'Management', vlan: 1, gatewaySubnet: '192.168.100.1/24', dhcpEnable: true },
    { id: '2', name: 'Smart Home', vlan: 20, gatewaySubnet: '192.168.120.1/24', dhcpEnable: true },
  ];

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true, writable: true });
    Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true, writable: true });
    vi.useRealTimers();
  });

  it('renders nothing when client is null', () => {
    const { container } = render(
      <ClientInspectorModal client={null} networks={mockNetworks} onClose={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders wireless client diagnostics, signal meter, and copies IP/MAC', async () => {
    const mockClient: OmadaClientDevice = {
      mac: 'AA-BB-CC-DD-EE-FF',
      name: 'MacBook Pro 16',
      ip: '192.168.120.45',
      wireless: true,
      ssid: 'TheFarmIot',
      apName: 'Main Center EAP670',
      vlanId: 20,
      rssi: -58,
      snr: 38,
      txRate: 9600,
      rxRate: 9600,
      activity: 1048576,
      trafficDown: 5000000,
      trafficUp: 2000000,
      uptime: 3600,
    };

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });

    const onClose = vi.fn();
    render(<ClientInspectorModal client={mockClient} networks={mockNetworks} onClose={onClose} />);

    expect(screen.getAllByText('MacBook Pro 16').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Apple Inc./i)).toBeInTheDocument();
    expect(screen.getByText('Smart Home (VLAN 20)')).toBeInTheDocument();
    expect(screen.getByText(/Excellent/i)).toBeInTheDocument();
    expect(screen.getByText('Main Center EAP670 (SSID: TheFarmIot)')).toBeInTheDocument();
    // Link rates are Kbps: 9600 Kbps is 9.6 Mbps, not "1.1 MB/s"
    expect(screen.getAllByText('9.6 Mbps')).toHaveLength(2);
    // No fabricated wired/gateway hops
    expect(screen.queryByText(/SG2218P/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ER7206/)).not.toBeInTheDocument();

    // Click copy IP and MAC
    const copyBtns = screen.getAllByRole('button', { name: /copy/i });
    expect(copyBtns.length).toBeGreaterThanOrEqual(2);
    await act(async () => {
      fireEvent.click(copyBtns[0]);
    });
    expect(writeText).toHaveBeenCalledWith('192.168.120.45');
    expect(screen.getByText('✓')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(copyBtns[1]);
    });
    expect(writeText).toHaveBeenCalledWith('AA-BB-CC-DD-EE-FF');

    // Click Done and Close
    const doneBtn = screen.getByRole('button', { name: /done/i });
    fireEvent.click(doneBtn);
    expect(onClose).toHaveBeenCalled();

    const closeIconBtn = screen.getByRole('button', { name: /close modal/i });
    fireEvent.click(closeIconBtn);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders wired client diagnostics without wireless RF section', () => {
    const wiredClient: OmadaClientDevice = {
      mac: '40:9B:CD:11:22:33',
      name: 'Ring Floodlight Cam',
      ip: '192.168.100.10',
      wireless: false,
      switchName: 'Backbone SG2218P',
      port: 4,
      vlanId: 1,
      activity: 0,
      trafficDown: 1000,
      trafficUp: 500,
      uptime: 120,
    };

    render(<ClientInspectorModal client={wiredClient} networks={mockNetworks} onClose={vi.fn()} />);
    expect(screen.getAllByText('Ring Floodlight Cam').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Ring \(Amazon\)/i)).toBeInTheDocument();
    expect(screen.getByText('Management (VLAN 1)')).toBeInTheDocument();
    expect(screen.queryByText(/RF Signal Strength/i)).not.toBeInTheDocument();
    expect(screen.getByText('Wired Ethernet')).toBeInTheDocument();
    expect(screen.getByText('Backbone SG2218P Port 4')).toBeInTheDocument();
    expect(screen.queryByText(/ER7206/)).not.toBeInTheDocument();
  });

  it('shows dashes instead of fabricated RF values and omits the uplink path when unreported', () => {
    const sparseClient: OmadaClientDevice = {
      mac: 'AA:00:00:00:00:01',
      name: 'Sparse Phone',
      ip: '192.168.1.50',
      wireless: true,
    };

    render(<ClientInspectorModal client={sparseClient} networks={mockNetworks} onClose={vi.fn()} />);
    expect(screen.getByText('Wi-Fi (standard not reported)')).toBeInTheDocument();
    expect(screen.queryByText(/Wi-Fi 6/)).not.toBeInTheDocument();
    expect(screen.getByText('Signal not reported')).toBeInTheDocument();
    expect(screen.queryByText(/Wired Connection/)).not.toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText(/-58 dBm/)).not.toBeInTheDocument();
    expect(screen.queryByText(/38 dB/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1\.2 Gbps/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Uplink Attachment Point/)).not.toBeInTheDocument();
  });

  it('formats Kbps link rates as Mbps/Gbps and falls back to AP/switch MACs for the uplink hop', () => {
    const { unmount } = render(
      <ClientInspectorModal
        client={{
          mac: 'AA:00:00:00:00:02',
          name: 'Laptop',
          ip: '192.168.1.51',
          wireless: true,
          apMac: 'ac-15-a2-00-00-01',
          rssi: -62,
          snr: 30,
          txRate: 866700,
          rxRate: 2402000,
        }}
        networks={mockNetworks}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('866.7 Mbps')).toBeInTheDocument();
    expect(screen.getByText('2.4 Gbps')).toBeInTheDocument();
    expect(screen.queryByText(/MB\/s/)).not.toBeInTheDocument();
    expect(screen.getByText('AC:15:A2:00:00:01')).toBeInTheDocument();
    expect(screen.getByText('-62 dBm')).toBeInTheDocument();
    expect(screen.getByText('30 dB')).toBeInTheDocument();
    unmount();

    render(
      <ClientInspectorModal
        client={{ mac: 'AA:00:00:00:00:03', hostName: 'nas', ip: '192.168.1.52', wireless: false, switchMac: '10-27-f5-00-00-09' }}
        networks={mockNetworks}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('10:27:F5:00:00:09')).toBeInTheDocument();
    expect(screen.getAllByText('nas').length).toBeGreaterThanOrEqual(1);
  });

  it('shows a failure label when copying is unavailable and clears it after a delay', async () => {
    vi.useFakeTimers();
    render(
      <ClientInspectorModal
        client={{ mac: 'AA:00:00:00:00:04', name: 'HTTP Client', ip: '192.168.1.53', wireless: false }}
        networks={mockNetworks}
        onClose={vi.fn()}
      />
    );

    const [copyIpBtn] = screen.getAllByRole('button', { name: /copy/i });
    await act(async () => {
      fireEvent.click(copyIpBtn);
    });
    expect(screen.getByText('Failed')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText('Failed')).not.toBeInTheDocument();
  });

  it('tests various Wi-Fi modes, signal tiers, and vendor recognitions', () => {
    const clients: OmadaClientDevice[] = [
      { mac: '24:dc:00:11:22:33', name: 'Shelly Plug', ip: '192.168.1.5', wireless: true, wifiMode: 4, rssi: -75 },
      { mac: '00:11:22:33:44:55', name: 'Galaxy Tab', ip: '192.168.1.6', wireless: true, wifiMode: 5, rssi: -85 },
      { mac: 'AA:11:22:33:44:55', name: 'Pixel Phone', ip: '192.168.1.7', wireless: true, wifiMode: 7, rssi: -65 },
      { mac: 'BB:11:22:33:44:55', name: 'Alexa Echo', ip: '192.168.1.8', wireless: true },
      { mac: 'CC:11:22:33:44:55', name: 'Starlink Dish', ip: '192.168.1.9', wireless: false },
      { mac: 'DD:11:22:33:44:55', hostName: 'unknown-host', ip: '192.168.1.10', wireless: false },
    ];

    clients.forEach((c) => {
      const { unmount } = render(<ClientInspectorModal client={c} networks={mockNetworks} onClose={vi.fn()} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      unmount();
    });
  });
});
