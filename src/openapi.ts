export const openApiDocument = {
  openapi: '3.1.0',
  info: { title: 'JoharHaat Marketplace API', version: '1.1.0', description: 'Customer, vendor and admin API for Jharkhand’s weekly marketplace.' },
  servers: [{ url: '/api/v1' }],
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } }, schemas: { Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string' } }, required: ['code','message','requestId'] } } } } },
  paths: {
    '/auth/register': { post: { summary: 'Register a customer account', tags: ['Auth'] } },
    '/auth/login': { post: { summary: 'Sign in with email and password', tags: ['Auth'] } },
    '/auth/refresh': { post: { summary: 'Rotate refresh session', tags: ['Auth'] } },
    '/auth/forgot-password': { post: { summary: 'Queue a password reset email', tags: ['Auth'] } },
    '/auth/reset-password': { post: { summary: 'Reset password with a single-use token', tags: ['Auth'] } },
    '/products/search': { get: { summary: 'Search available products', tags: ['Catalog'] } },
    '/checkout': { post: { summary: 'Create a multi-vendor order transactionally', tags: ['Commerce'], security: [{ bearerAuth: [] }] } },
    '/cart': { get: { summary: 'Get active cart', tags: ['Commerce'], security: [{ bearerAuth: [] }] } },
    '/orders': { get: { summary: 'List customer orders', tags: ['Commerce'], security: [{ bearerAuth: [] }] } },
    '/vendor/dashboard': { get: { summary: 'Get vendor operational dashboard', tags: ['Vendor'], security: [{ bearerAuth: [] }] } },
    '/admin/analytics': { get: { summary: 'Get marketplace analytics', tags: ['Admin'], security: [{ bearerAuth: [] }] } },
  },
} as const;
