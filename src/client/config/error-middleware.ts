import type { Middleware } from '@reduxjs/toolkit';

type ErrorData = {
  message: string;
  fieldErrors?: Array<{ field: string; objectName: string; message: string }>;
};

const getErrorMessage = (errorData: ErrorData) => {
  let { message } = errorData;
  if (errorData.fieldErrors) {
    errorData.fieldErrors.forEach((fErr: { field: string; objectName: string; message: string }) => {
      message += `\nfield: ${fErr.field}, Object: ${fErr.objectName}, message: ${fErr.message}\n`;
    });
  }
  return message;
};

const errorMiddleware: Middleware = () => next => action => {
  /**
   *
   * The error middleware serves to log error messages from dispatch
   * It need not run in production
   */
  if (DEVELOPMENT) {
    const { error, type } = action as { error?: { message?: unknown; response?: { data?: ErrorData } }; type?: unknown };
    if (error) {
      console.error(`${String(type)} caught at middleware with reason: ${JSON.stringify(error.message)}.`);
      if (error.response?.data) {
        const message = getErrorMessage(error.response.data);
        console.error(`Actual cause: ${message}`);
      }
    }
  }
  // Dispatch initial action
  return next(action);
};

export default errorMiddleware;
