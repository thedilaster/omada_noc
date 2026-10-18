import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { updateUserRole, updateUserPassword, deleteUser, findUserById, countAdmins } from '@/lib/db/queries';
import { hashPassword } from '@/lib/auth/password';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;

    const { id } = await params;
    const body = await request.json();
    const { role, newPassword } = body;

    const user = await findUserById(id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Validate everything before writing so a rejected request changes nothing
    if (newPassword && newPassword.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long.' },
        { status: 400 }
      );
    }

    const roleChange = (role === 'ADMIN' || role === 'USER') && role !== user.role ? role : null;

    if (roleChange && id === guard.session.userId) {
      return NextResponse.json(
        { error: 'You cannot change the role of your own administrator account.' },
        { status: 400 }
      );
    }

    if (roleChange === 'USER' && user.role === 'ADMIN' && (await countAdmins()) <= 1) {
      return NextResponse.json(
        { error: 'Cannot demote the last remaining administrator.' },
        { status: 400 }
      );
    }

    if (roleChange) {
      await updateUserRole(id, roleChange);
    }

    if (newPassword) {
      const hashed = await hashPassword(newPassword);
      await updateUserPassword(id, hashed);
    }

    const updatedUser = await findUserById(id);
    return NextResponse.json({
      success: true,
      message: 'User updated successfully',
      user: updatedUser,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;

    const { id } = await params;

    // Prevent self-deletion
    if (guard.session.userId === id) {
      return NextResponse.json(
        { error: 'You cannot delete your own active administrator account.' },
        { status: 400 }
      );
    }

    const user = await findUserById(id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (user.role === 'ADMIN' && (await countAdmins()) <= 1) {
      return NextResponse.json(
        { error: 'Cannot delete the last remaining administrator.' },
        { status: 400 }
      );
    }

    const deleted = await deleteUser(id);
    if (!deleted) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'User deleted successfully' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
