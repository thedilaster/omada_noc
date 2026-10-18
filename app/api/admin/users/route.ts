import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { listAllUsersWithDetails, createUser, findUserByEmailOrUsername } from '@/lib/db/queries';
import { hashPassword } from '@/lib/auth/password';

export async function GET() {
  try {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;

    const users = await listAllUsersWithDetails();
    return NextResponse.json({ users });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;

    const body = await request.json();
    const { username, email, password, role, fullName } = body;

    if (!username || !email || !password) {
      return NextResponse.json(
        { error: 'Username, email, and password are required.' },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long.' },
        { status: 400 }
      );
    }

    const existingEmail = await findUserByEmailOrUsername(email);
    const existingUsername = await findUserByEmailOrUsername(username);
    if (existingEmail || existingUsername) {
      return NextResponse.json(
        { error: 'A user with this email or username already exists.' },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);
    const userRole = role === 'ADMIN' ? 'ADMIN' : 'USER';

    const newUser = await createUser(username, email, passwordHash, userRole, fullName);

    return NextResponse.json({
      success: true,
      message: 'User created successfully',
      user: newUser,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
