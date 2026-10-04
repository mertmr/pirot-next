/* eslint no-console: off */
import type { Middleware } from '@reduxjs/toolkit';

const loggerMiddleware: Middleware = () => next => action => {
  if (DEVELOPMENT) {
    const { type, payload, meta } = action as { type?: unknown; payload?: unknown; meta?: unknown };

    console.groupCollapsed(type);
    console.log('Payload:', payload);
    console.log('Meta:', meta);
    console.groupEnd();
  }

  return next(action);
};

export default loggerMiddleware;
