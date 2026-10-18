import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import VlanWifiView from '@/app/components/VlanWifiView';
import { OmadaLanNetwork, OmadaSsidSetting } from '@/types/omada';

describe('VlanWifiView Component', () => {
  it('renders honest empty status when no data is provided', () => {
    render(<VlanWifiView />);
    expect(screen.getByText(/VLAN Network Segmentation Matrix/i)).toBeInTheDocument();
    expect(screen.getByText(/No managed VLAN networks detected on this site/i)).toBeInTheDocument();
    expect(screen.getByText(/No wireless SSIDs detected on this site/i)).toBeInTheDocument();
  });

  it('renders custom networks and SSIDs cleanly', () => {
    const customNetworks: OmadaLanNetwork[] = [
      {
        id: 'n1',
        name: 'Corporate VLAN',
        vlan: 100,
        gatewaySubnet: '10.100.0.1/24',
        dhcpEnable: true,
        ipaddrStart: '10.100.0.10',
        ipaddrEnd: '10.100.0.250',
        domain: 'corp.local',
        clientCount: 42,
      },
    ];

    const customSsids: OmadaSsidSetting[] = [
      {
        id: 's1',
        name: 'Corp-Secure-WiFi',
        band: 3,
        bandText: 'Dual-Band (2.4G + 5G)',
        security: 4,
        securityText: 'WPA3-SAE / WPA2',
        broadcast: false,
        vlanEnable: true,
        vlanId: 100,
        clientCount: 42,
      },
    ];

    render(<VlanWifiView networks={customNetworks} ssids={customSsids} siteName="HQ Office" />);
    expect(screen.getByText(/HQ Office/i)).toBeInTheDocument();
    expect(screen.getByText(/Corporate VLAN/i)).toBeInTheDocument();
    expect(screen.getByText(/Corp-Secure-WiFi/i)).toBeInTheDocument();
    expect(screen.getByText(/Hidden/i)).toBeInTheDocument();
    expect(screen.getByText(/42 clients/i)).toBeInTheDocument();
    expect(screen.getByText('10.100.0.10 - 10.100.0.250')).toBeInTheDocument();
  });

  it('labels the management and DMZ VLANs and falls back for SSID band/security text', () => {
    const networks: OmadaLanNetwork[] = [
      { id: 'm', name: 'Default', vlan: 1, gatewaySubnet: '192.168.0.1/24', dhcpEnable: true },
      { id: 'd', name: 'Public', vlan: 50, gatewaySubnet: '192.168.50.1/24', dhcpEnable: true },
    ];
    const ssids: OmadaSsidSetting[] = [
      { id: 'a', name: 'IoT-2G', band: 1, security: 3, broadcast: true, vlanEnable: false },
      { id: 'b', name: 'Main', band: 3, security: 3, broadcast: true, vlanEnable: false },
    ];

    render(<VlanWifiView networks={networks} ssids={ssids} />);
    expect(screen.getByText('Management')).toBeInTheDocument();
    expect(screen.getByText('DMZ')).toBeInTheDocument();
    expect(screen.getByText('2.4 GHz')).toBeInTheDocument();
    expect(screen.getByText('Dual-Band')).toBeInTheDocument();
    expect(screen.getAllByText('Untagged (VLAN 1)')).toHaveLength(2);
  });

  it('shows Disabled when DHCP is off and Enabled when the pool range is not reported', () => {
    const networks: OmadaLanNetwork[] = [
      {
        id: 'n1',
        name: 'Static Servers',
        vlan: 30,
        gatewaySubnet: '10.30.0.1/24',
        dhcpEnable: false,
        ipaddrStart: '10.30.0.10',
        ipaddrEnd: '10.30.0.20',
      },
      { id: 'n2', name: 'Guest', vlan: 40, gatewaySubnet: '10.40.0.1/24', dhcpEnable: true },
    ];

    render(<VlanWifiView networks={networks} />);
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.queryByText(/10\.30\.0\.10/)).not.toBeInTheDocument();
  });
});
