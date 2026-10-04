import { createAsyncThunk, isFulfilled, isPending } from '@reduxjs/toolkit';
import axios from 'axios';

import { IStokGirisi, defaultValue } from 'app/shared/model/stok-girisi.model';
import { EntityState, IQueryParams, createEntitySlice, serializeAxiosError } from 'app/shared/reducers/reducer.utils';
import { cleanEntity } from 'app/shared/util/entity-utils';

const initialState: EntityState<IStokGirisi> = {
  loading: false,
  errorMessage: null,
  entities: [],
  entity: defaultValue,
  updating: false,
  totalItems: 0,
  updateSuccess: false,
};

const apiUrl = 'api/stok-girisis';
const apiSearchUrl = 'api/searchStokGirisiByUrun';

// Actions

export const getEntities = createAsyncThunk(
  'stokGirisi/fetch_entity_list',
  async ({ page, size, sort }: IQueryParams) => {
    const requestUrl = `${apiUrl}?${sort ? `page=${page}&size=${size}&sort=${sort}&` : ''}cacheBuster=${Date.now()}`;
    return axios.get<IStokGirisi[]>(requestUrl);
  },
  { serializeError: serializeAxiosError },
);

export const getSearchEntities = createAsyncThunk(
  'stokGirisi/search_entity_list',
  async ({ query, page, size, sort }: IQueryParams & { query: string }) => {
    const requestUrl = `${apiSearchUrl}?query=${encodeURIComponent(query)}${sort ? `&page=${page}&size=${size}&sort=${sort}` : ''}`;
    return axios.get<IStokGirisi[]>(requestUrl);
  },
  { serializeError: serializeAxiosError },
);

export const getEntity = createAsyncThunk(
  'stokGirisi/fetch_entity',
  async (id: string | number) => {
    const requestUrl = `${apiUrl}/${id}`;
    return axios.get<IStokGirisi>(requestUrl);
  },
  { serializeError: serializeAxiosError },
);

export const createEntity = createAsyncThunk(
  'stokGirisi/create_entity',
  async (entity: IStokGirisi) => {
    const result = await axios.post<IStokGirisi>(apiUrl, cleanEntity(entity));
    return result;
  },
  { serializeError: serializeAxiosError },
);

export const updateEntity = createAsyncThunk(
  'stokGirisi/update_entity',
  async (entity: IStokGirisi) => {
    const result = await axios.put<IStokGirisi>(`${apiUrl}/${entity.id}`, cleanEntity(entity));
    return result;
  },
  { serializeError: serializeAxiosError },
);

export const deleteEntity = createAsyncThunk(
  'stokGirisi/delete_entity',
  async (id: string | number) => {
    const requestUrl = `${apiUrl}/${id}`;
    const result = await axios.delete<IStokGirisi>(requestUrl);
    return result;
  },
  { serializeError: serializeAxiosError },
);

// slice

export const StokGirisiSlice = createEntitySlice({
  name: 'stokGirisi',
  initialState,
  extraReducers(builder) {
    builder
      .addCase(getEntity.fulfilled, (state, action) => {
        state.loading = false;
        state.entity = action.payload.data;
      })
      .addCase(deleteEntity.fulfilled, state => {
        state.updating = false;
        state.updateSuccess = true;
        state.entity = {};
      })
      .addMatcher(isFulfilled(getEntities, getSearchEntities), (state, action) => {
        const { data, headers } = action.payload;

        return {
          ...state,
          loading: false,
          entities: data,
          totalItems: parseInt(headers['x-total-count'], 10),
        };
      })
      .addMatcher(isFulfilled(createEntity, updateEntity), (state, action) => {
        state.updating = false;
        state.loading = false;
        state.updateSuccess = true;
        state.entity = action.payload.data;
      })
      .addMatcher(isPending(getEntities, getSearchEntities, getEntity), state => {
        state.errorMessage = null;
        state.updateSuccess = false;
        state.loading = true;
      })
      .addMatcher(isPending(createEntity, updateEntity, deleteEntity), state => {
        state.errorMessage = null;
        state.updateSuccess = false;
        state.updating = true;
      });
  },
});

export const { reset } = StokGirisiSlice.actions;

// Reducer
export default StokGirisiSlice.reducer;
