import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hash, verify } from 'argon2';
import { SignJWT } from 'jose';
import { UserRole } from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../utils/api-error.js';

const secret = new TextEncoder().encode(env.JWT_SECRET);
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const publicUser = { id: true, name: true, email: true, mobile: true, role: true, isActive: true, createdAt: true } as const;

async function accessToken(user: { id: string; role: UserRole }): Promise<string> {
  return new SignJWT({ role: user.role }).setProtectedHeader({ alg: 'HS256' }).setSubject(user.id).setIssuer(env.JWT_ISSUER).setAudience(env.JWT_AUDIENCE).setIssuedAt().setExpirationTime(env.ACCESS_TOKEN_TTL).sign(secret);
}

async function issueSession(user: { id: string; role: UserRole }, context: { userAgent: string | undefined; ip: string | undefined }, familyId: string = randomUUID()) {
  const refreshToken = randomBytes(48).toString('base64url');
  const session = await prisma.authSession.create({ data: { userId: user.id, refreshTokenHash: tokenHash(refreshToken), familyId, expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000), userAgent: context.userAgent ?? null, ipAddress: context.ip ?? null } });
  return { accessToken: await accessToken(user), refreshToken, sessionId: session.id };
}

export async function register(input: { name: string; email: string; mobile: string; password: string }, context: { userAgent: string | undefined; ip: string | undefined }) {
  const duplicate = await prisma.user.findFirst({ where: { OR: [{ email: input.email }, { mobile: input.mobile }] } });
  if (duplicate) throw new ApiError(409, 'An account already exists with this email or mobile.', 'ACCOUNT_EXISTS');
  const user = await prisma.user.create({ data: { name: input.name, email: input.email, mobile: input.mobile, passwordHash: await hash(input.password, { type: 2 }), role: UserRole.CUSTOMER }, select: publicUser });
  return { user, ...(await issueSession(user, context)) };
}

export async function login(input: { email: string; password: string }, context: { userAgent: string | undefined; ip: string | undefined }) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user?.passwordHash || !user.isActive || !(await verify(user.passwordHash, input.password))) throw new ApiError(401, 'Email or password is incorrect.', 'INVALID_CREDENTIALS');
  const safe = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: publicUser });
  return { user: safe, ...(await issueSession(user, context)) };
}

export async function refresh(refreshToken: string, context: { userAgent: string | undefined; ip: string | undefined }) {
  const session = await prisma.authSession.findUnique({ where: { refreshTokenHash: tokenHash(refreshToken) }, include: { user: true } });
  if (!session || session.expiresAt <= new Date() || !session.user.isActive) throw new ApiError(401, 'Refresh token is invalid or expired.', 'INVALID_REFRESH_TOKEN');
  if (session.revokedAt) {
    await prisma.authSession.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    throw new ApiError(401, 'Refresh token reuse detected; this session family was revoked.', 'REFRESH_REUSE_DETECTED');
  }
  const next = await issueSession(session.user, context, session.familyId);
  await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), replacedById: next.sessionId } });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId }, select: publicUser });
  return { user, ...next };
}

export async function logout(refreshToken?: string): Promise<void> {
  if (refreshToken) await prisma.authSession.updateMany({ where: { refreshTokenHash: tokenHash(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
}
export async function revokeAll(userId: string): Promise<void> { await prisma.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }); }

export async function forgotPassword(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;
  const token = randomBytes(32).toString('base64url');
  await prisma.$transaction([
    prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + env.PASSWORD_RESET_MINUTES * 60_000) } }),
    prisma.emailOutbox.create({ data: { recipient: email, subject: 'Reset your JoharHaat password', template: 'password-reset', payload: { token, expiresMinutes: env.PASSWORD_RESET_MINUTES } } }),
  ]);
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: tokenHash(token) } });
  if (!record || record.usedAt || record.expiresAt <= new Date()) throw new ApiError(400, 'Password reset token is invalid or expired.', 'INVALID_RESET_TOKEN');
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash: await hash(password, { type: 2 }) } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.authSession.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}
