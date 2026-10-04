import { createAsyncThunk, isFulfilled, isPending } from '@reduxjs/toolkit';
import axios from 'axios';

import { ISatis, ISatisRequest, defaultValue } from 'app/shared/model/satis.model';
import { EntityState, IQueryParams, createEntitySlice, serializeAxiosError } from 'app/shared/reducers/reducer.utils';
import { cleanEntity } from 'app/shared/util/entity-utils';

const initialState: EntityState<ISatis> = {
  loading: false,
  errorMessage: null,
  entities: [],
  entity: defaultValue,
  updating: false,
  totalItems: 0,
  updateSuccess: false,
};

const apiUrl = 'api/satis';
const apiSearchUrl = 'api/_search/satis';

// Actions

export const getEntities = createAsyncThunk(
  'satis/fetch_entity_list',
  async ({ page, size, sort }: IQueryParams) => {
    const requestUrl = `${apiUrl}?${sort ? `page=${page}&size=${size}&sort=${sort}&` : ''}cacheBuster=${Date.now()}`;
    return axios.get<ISatis[]>(requestUrl);
  },
  { serializeError: serializeAxiosError },
);

export const getEntity = createAsyncThunk(
  'satis/fetch_entity',
  async (id: string | number) => {
    const requestUrl = `${apiUrl}/${id}`;
    return axios.get<ISatis>(requestUrl);
  },
  { serializeError: serializeAxiosError },
);

export const getSearchEntities = createAsyncThunk(
  'satis/search_entity_list',
  async ({ query, page, size, sort }: IQueryParams & { query: string }) => {
    const requestUrl = `${apiSearchUrl}?query=${query}${sort ? `&page=${page}&size=${size}&sort=${sort}` : ''}`;
    return axios.get<ISatis[]>(requestUrl);
  },
  { serializeError: serializeAxiosError },
);

export const createEntity = createAsyncThunk(
  'satis/create_entity',
  async (entity: ISatisRequest) => {
    const result = await axios.post<ISatis>(apiUrl, cleanEntity(entity));
    return result;
  },
  { serializeError: serializeAxiosError },
);

export const createEntityWithNote = createAsyncThunk(
  'satis/create_entity_with_note',
  async ({ entity, note }: { entity: ISatisRequest; note: string }) =>
    axios.post<ISatis>(`${apiUrl}?paymentNote=${encodeURIComponent(note)}`, cleanEntity(entity)),
  { serializeError: serializeAxiosError },
);

export const updateEntity = createAsyncThunk(
  'satis/update_entity',
  async (entity: ISatisRequest) => {
    const result = await axios.put<ISatis>(apiUrl, cleanEntity(entity));
    return result;
  },
  { serializeError: serializeAxiosError },
);

export const deleteEntity = createAsyncThunk(
  'satis/delete_entity',
  async (input: string | number | { id: number; duzeltme?: import('app/shared/model/nobet-duzeltme.model').IDuzeltmeTalebi }) => {
    const id = typeof input === 'object' ? input.id : input;
    const params = typeof input === 'object' && input.duzeltme ? input.duzeltme : undefined;
    const requestUrl = `${apiUrl}/${id}`;
    const result = await axios.delete<ISatis>(requestUrl, { params });
    return result;
  },
  { serializeError: serializeAxiosError },
);

// slice

export const SatisSlice = createEntitySlice({
  name: 'satis',
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
      .addMatcher(isFulfilled(createEntity, createEntityWithNote, updateEntity), (state, action) => {
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
      .addMatcher(isPending(createEntity, createEntityWithNote, updateEntity, deleteEntity), state => {
        state.errorMessage = null;
        state.updateSuccess = false;
        state.updating = true;
      });
  },
});

export const { reset } = SatisSlice.actions;

// Reducer
export default SatisSlice.reducer;
