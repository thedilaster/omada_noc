import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { getUserDeviceTags, tagDeviceToUser, removeDeviceTagFromUser, findUserById } from '@/lib/db/queries';
import { toCanonicalMac } from '@/lib/db/validation';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;

    const { id } = await params;
    const tags = await getUserDeviceTags(id);
    return NextResponse.json({ devices: tags });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;

    const { id } = await params;
    const body = await request.json();
    const { macAddress, deviceName } = body;

    if (!macAddress) {
      return NextResponse.json({ error: 'MAC address is required.' }, { status: 400 });
    }

    if (!toCanonicalMac(typeof macAddress === 'string' ? macAddress : '')) {
      return NextResponse.json(
        { error: 'Invalid MAC address. Expected 12 hex digits, e.g. AA-BB-CC-DD-EE-FF.' },
        { status: 400 }
      );
    }

    // Avoid tagging devices to a nonexistent account (FK violation / orphaned memory tag)
    const user = await findUserById(id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const tag = await tagDeviceToUser(id, macAddress, deviceName || '');
    return NextResponse.json({
      success: true,
      message: 'Device tagged to user successfully',
      device: tag,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const macAddress = searchParams.get('mac');

    if (!macAddress) {
      return NextResponse.json({ error: 'MAC address parameter is required.' }, { status: 400 });
    }

    await removeDeviceTagFromUser(id, macAddress);
    return NextResponse.json({ success: true, message: 'Device tag removed successfully' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
