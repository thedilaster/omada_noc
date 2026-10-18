import { NextResponse } from 'next/server';
import { getOmadaClient } from '@/lib/omada/client';
import { TelemetryResponse, OmadaClientDevice } from '@/types/omada';
import { getCurrentSession } from '@/lib/auth/session';
import { resolveTelemetryViewer, scopeTelemetry } from '@/lib/auth/device-scope';
import { parseBoundedInt } from '@/lib/db/validation';
import { resolveClientVlan } from '@/lib/omada/formatters';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseBoundedInt(searchParams.get('limit'), 10, 1, 1000);
    const includeAll = searchParams.get('all') === 'true';
    const sortBy = (searchParams.get('sort') || 'activity') as 'activity' | 'traffic' | 'uptime';

    const client = getOmadaClient();
    const rawStatus = await client.getNetworkStatus();

    let clients: OmadaClientDevice[] = [];

    let topology = undefined;
    let netData = undefined;
    let ssidData = undefined;
    let poeDevices = undefined;
    let devices = undefined;
    let wanData = undefined;
    let eventData = undefined;

    if (rawStatus.controllerOnline) {
      try {
        const [rawClients, topoData, nets, ssidList, poeData, devData, wan, evts] = await Promise.all([
          client.getActiveClients(),
          typeof client.getTopology === 'function' ? client.getTopology().catch(() => []) : Promise.resolve([]),
          typeof client.getLanNetworks === 'function' ? client.getLanNetworks().catch(() => []) : Promise.resolve([]),
          typeof client.getSsids === 'function' ? client.getSsids().catch(() => []) : Promise.resolve([]),
          typeof client.getPoeBudgets === 'function' ? client.getPoeBudgets().catch(() => []) : Promise.resolve([]),
          typeof client.getDevices === 'function' ? client.getDevices().catch(() => []) : Promise.resolve([]),
          typeof client.getWanStatus === 'function' ? client.getWanStatus().catch(() => undefined) : Promise.resolve(undefined),
          typeof client.getNocEvents === 'function' ? client.getNocEvents().catch(() => []) : Promise.resolve([]),
        ]);

        // Enrich clients with resolved vlanId
        clients = (rawClients || []).map((c) => ({
          ...c,
          vlanId: resolveClientVlan(c, nets, ssidList),
        }));
        topology = topoData;
        netData = nets;
        ssidData = ssidList;
        poeDevices = poeData;
        devices = devData;
        wanData = wan;
        eventData = evts;
      } catch (err) {
        console.error('Error fetching clients in telemetry route:', err);
      }
    }

    // Device Tagging Scoping (shared with the dashboard page); fails closed for non-admins
    const viewer = await resolveTelemetryViewer(await getCurrentSession());
    const scopedView = await scopeTelemetry(viewer, {
      status: { ...rawStatus },
      clients,
      networks: netData,
      ssids: ssidData,
      wanStatus: wanData,
      events: eventData,
    });
    const { status, networks, ssids, wanStatus, events } = scopedView;

    const sorted = [...scopedView.clients].sort((a, b) => {
      if (sortBy === 'activity') return (b.activity || 0) - (a.activity || 0);
      if (sortBy === 'traffic') {
        const aT = (a.trafficDown || 0) + (a.trafficUp || 0);
        const bT = (b.trafficDown || 0) + (b.trafficUp || 0);
        return bT - aT;
      }
      if (sortBy === 'uptime') return (b.uptime || 0) - (a.uptime || 0);
      return 0;
    });

    const topClients = sorted.slice(0, limit);
    const allClients = includeAll ? sorted : undefined;

    const payload: TelemetryResponse = {
      status,
      topClients,
      ...(includeAll && { allClients }),
      ...(topology && { topology }),
      ...(networks && { networks }),
      ...(ssids && { ssids }),
      ...(poeDevices && { poeDevices }),
      ...(devices && { devices }),
      ...(wanStatus && { wanStatus }),
      ...(events && { events }),
    };

    return NextResponse.json(payload, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json(
      {
        error: message,
        status: {
          controllerOnline: false,
          omadacId: null,
          siteId: 'unknown',
          totalClients: 0,
          wirelessClients: 0,
          wiredClients: 0,
          totalActivityRate: 0,
          totalTrafficDown: 0,
          totalTrafficUp: 0,
          lastUpdated: new Date().toISOString(),
          error: message,
        },
        topClients: [],
      },
      { status: 500 }
    );
  }
}
