import type { Request, RequestHandler, Response } from 'express';
import * as auth from '../services/auth.service.js';

const cookieName = 'joharhaat_refresh';
const context = (request: Request) => ({ userAgent: request.get('user-agent'), ip: request.ip });
const readCookie = (request: Request) => request.headers.cookie?.split(';').map((value) => value.trim()).find((value) => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
const setRefresh = (response: Response, token: string) => response.cookie(cookieName, token, { httpOnly: true, secure: process.env.COOKIE_SECURE === 'true', sameSite: 'lax', path: '/api/v1/auth', maxAge: 30 * 86_400_000 });
const sessionResponse = (response: Response, result: Awaited<ReturnType<typeof auth.login>>, status = 200) => { setRefresh(response, result.refreshToken); response.status(status).json({ data: { user: result.user, accessToken: result.accessToken } }); };

export const registerController: RequestHandler = async (request, response) => sessionResponse(response, await auth.register(request.body, context(request)), 201);
export const loginController: RequestHandler = async (request, response) => sessionResponse(response, await auth.login(request.body, context(request)));
export const refreshController: RequestHandler = async (request, response) => sessionResponse(response, await auth.refresh(readCookie(request) ?? '', context(request)));
export const logoutController: RequestHandler = async (request, response) => { await auth.logout(readCookie(request)); response.clearCookie(cookieName, { path: '/api/v1/auth' }).status(204).end(); };
export const revokeAllController: RequestHandler = async (request, response) => { await auth.revokeAll(request.auth!.userId); response.clearCookie(cookieName, { path: '/api/v1/auth' }).status(204).end(); };
export const forgotPasswordController: RequestHandler = async (request, response) => { await auth.forgotPassword(request.body.email); response.status(202).json({ data: { message: 'If this account exists, a reset message has been queued.' } }); };
export const resetPasswordController: RequestHandler = async (request, response) => { await auth.resetPassword(request.body.token, request.body.password); response.status(204).end(); };
