import { redirect } from 'next/navigation';
import Dashboard from '@/app/components/Dashboard';
import { getOmadaClient } from '@/lib/omada/client';
import { getCurrentSession } from '@/lib/auth/session';
import { scopeTelemetry } from '@/lib/auth/device-scope';
import { findUserById } from '@/lib/db/queries';
import { TelemetryResponse, OmadaClientDevice } from '@/types/omada';
import { resolveClientVlan } from '@/lib/omada/formatters';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const session = await getCurrentSession();
  if (!session) {
    redirect('/login');
    return null;
  }

  // Verify the user still exists in the database (handles DB recreation / orphaned JWTs)
  const dbUser = await findUserById(session.userId);
  if (!dbUser) {
    // Server Components can't clear cookies; the logout route clears it and redirects to /login
    // (redirecting to /login directly loops, since the proxy bounces the still-valid JWT back here)
    redirect('/api/auth/logout');
    return null;
  }

  const client = getOmadaClient();
  const status = await client.getNetworkStatus();
  
  let clients: OmadaClientDevice[] = [];
  let topology = undefined;
  let netData = undefined;
  let ssidData = undefined;
  let poeDevices = undefined;
  let devices = undefined;
  let wanData = undefined;
  let eventData = undefined;

  if (status.controllerOnline) {
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
      console.error('Failed to load initial client list:', err);
    }
  }

  // Device Tagging Matrix Scoping (shared with /api/telemetry), using the stored role rather than
  // the JWT claim so a demoted admin is scoped immediately; fails closed if tag lookup errors
  const { status: scopedStatus, clients: filteredClients, networks, ssids, wanStatus, events } =
    await scopeTelemetry(
      { userId: dbUser.id, role: dbUser.role },
      { status, clients, networks: netData, ssids: ssidData, wanStatus: wanData, events: eventData }
    );

  const initialData: TelemetryResponse = {
    status: scopedStatus,
    topClients: filteredClients.slice(0, 50),
    allClients: filteredClients,
    ...(topology && { topology }),
    ...(networks && { networks }),
    ...(ssids && { ssids }),
    ...(poeDevices && { poeDevices }),
    ...(devices && { devices }),
    ...(wanStatus && { wanStatus }),
    ...(events && { events }),
  };

  return <Dashboard initialData={initialData} />;
}