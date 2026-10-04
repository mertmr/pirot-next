import { createAsyncThunk, createSlice, isPending, isRejected } from '@reduxjs/toolkit';
import axios from 'axios';

import { serializeAxiosError } from 'app/shared/reducers/reducer.utils';

// Only the health endpoint exists on the server. The former metrics, thread dump,
// logger and configuration screens targeted Spring Actuator paths that this Worker
// never implemented, so their thunks were removed with the screens.
const initialState = {
  loading: false,
  errorMessage: null as string | null,
  health: {} as any,
};

// Actions

export const getSystemHealth = createAsyncThunk('administration/fetch_health', async () => axios.get<any>('management/health'), {
  serializeError: serializeAxiosError,
});

export const AdministrationSlice = createSlice({
  name: 'administration',
  initialState,
  reducers: {},
  extraReducers(builder) {
    builder
      .addCase(getSystemHealth.fulfilled, (state, action) => {
        state.loading = false;
        state.health = action.payload.data;
      })
      .addMatcher(isPending(getSystemHealth), state => {
        state.errorMessage = null;
        state.loading = true;
      })
      .addMatcher(isRejected(getSystemHealth), (state, action) => {
        state.errorMessage = action.error.message!;
        state.loading = false;
      });
  },
});

// Reducer
export default AdministrationSlice.reducer;
