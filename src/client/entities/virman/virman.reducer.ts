import { createAsyncThunk, isFulfilled, isPending } from '@reduxjs/toolkit';
import axios from 'axios';

import { IVirman, defaultValue } from 'app/shared/model/virman.model';
import { EntityState, IQueryParams, createEntitySlice, serializeAxiosError } from 'app/shared/reducers/reducer.utils';
import { cleanEntity } from 'app/shared/util/entity-utils';

const initialState: EntityState<IVirman> = {
  loading: false,
  errorMessage: null,
  entities: [],
  entity: defaultValue,
  updating: false,
  totalItems: 0,
  updateSuccess: false,
};

const apiUrl = 'api/virmen';
const apiSearchUrl = 'api/_search/virman';

// Actions

export const getEntities = createAsyncThunk(
  'virman/fetch_entity_list',
  async ({ page, size, sort }: IQueryParams) => {
    const requestUrl = `${apiUrl}?${sort ? `page=${page}&size=${size}&sort=${sort}&` : ''}cacheBuster=${Date.now()}`;
    return axios.get<IVirman[]>(requestUrl);
  },
  { serializeError: serializeAxiosError },
);

export const getSearchEntities = createAsyncThunk(
  'virman/search_entity_list',
  async ({ query, page, size, sort }: IQueryParams & { query: string }) => {
    const requestUrl = `${apiSearchUrl}?query=${query}${sort ? `&page=${page}&size=${size}&sort=${sort}` : ''}`;
    return axios.get<IVirman[]>(requestUrl);
  },
  { serializeError: serializeAxiosError },
);

export const getEntity = createAsyncThunk(
  'virman/fetch_entity',
  async (id: string | number) => {
    const requestUrl = `${apiUrl}/${id}`;
    return axios.get<IVirman>(requestUrl);
  },
  { serializeError: serializeAxiosError },
);

export const createEntity = createAsyncThunk(
  'virman/create_entity',
  async (entity: IVirman) => {
    const result = await axios.post<IVirman>(apiUrl, cleanEntity(entity));
    return result;
  },
  { serializeError: serializeAxiosError },
);

export const updateEntity = createAsyncThunk(
  'virman/update_entity',
  async (entity: IVirman) => {
    const result = await axios.put<IVirman>(`${apiUrl}/${entity.id}`, cleanEntity(entity));
    return result;
  },
  { serializeError: serializeAxiosError },
);

export const deleteEntity = createAsyncThunk(
  'virman/delete_entity',
  async (input: string | number | { id: number; duzeltme?: import('app/shared/model/nobet-duzeltme.model').IDuzeltmeTalebi }) => {
    const id = typeof input === 'object' ? input.id : input;
    const params = typeof input === 'object' && input.duzeltme ? input.duzeltme : undefined;
    const requestUrl = `${apiUrl}/${id}`;
    const result = await axios.delete<IVirman>(requestUrl, { params });
    return result;
  },
  { serializeError: serializeAxiosError },
);

// slice

export const VirmanSlice = createEntitySlice({
  name: 'virman',
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
      .addMatcher(isPending(getEntities, getEntity, getSearchEntities), state => {
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

export const { reset } = VirmanSlice.actions;

// Reducer
export default VirmanSlice.reducer;
