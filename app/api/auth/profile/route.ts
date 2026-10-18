import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth/session';
import {
  findUserByEmailOrUsername,
  upsertUserProfile,
  updateUserPassword,
} from '@/lib/db/queries';
import { verifyPassword, hashPassword } from '@/lib/auth/password';

export async function PUT(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { fullName, jobTitle, department, avatarUrl, theme, currentPassword, newPassword } = body;

    // 1. Validate an optional password change first so a rejected request saves nothing
    let newPasswordHash: string | null = null;
    if (newPassword) {
      if (!currentPassword) {
        return NextResponse.json(
          { error: 'Current password is required to set a new password.' },
          { status: 400 }
        );
      }

      if (newPassword.length < 8) {
        return NextResponse.json(
          { error: 'New password must be at least 8 characters long.' },
          { status: 400 }
        );
      }

      const userWithHash = await findUserByEmailOrUsername(session.email);
      if (!userWithHash) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      const isCurrentValid = await verifyPassword(currentPassword, userWithHash.passwordHash);
      if (!isCurrentValid) {
        return NextResponse.json(
          { error: 'Current password provided is incorrect.' },
          { status: 400 }
        );
      }

      newPasswordHash = await hashPassword(newPassword);
    }

    // 2. Update Profile Information
    const updatedProfile = await upsertUserProfile(session.userId, {
      fullName,
      jobTitle,
      department,
      avatarUrl,
      theme,
    });

    // 3. Apply the validated password change
    if (newPasswordHash) {
      await updateUserPassword(session.userId, newPasswordHash);
    }

    return NextResponse.json({
      success: true,
      message: 'Profile updated successfully',
      profile: updatedProfile,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
