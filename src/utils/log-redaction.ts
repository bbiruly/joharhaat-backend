export const requestLogRedaction = {
  paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.set-cookie', 'req.headers.x-api-key'],
  censor: '[REDACTED]',
};
