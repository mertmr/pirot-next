import { createAsyncThunk, isFulfilled, isPending } from '@reduxjs/toolkit';
import axios from 'axios';

import { IUrun, defaultValue } from 'app/shared/model/urun.model';
import { IUretici } from 'app/shared/model/uretici.model';
import { EntityState, IQueryParams, createEntitySlice, serializeAxiosError } from 'app/shared/reducers/reducer.utils';
import { cleanEntity } from 'app/shared/util/entity-utils';

type UrunState = EntityState<IUrun> & {
  ureticis: IUretici[];
  satisUrunleri: IUrun[];
};

const initialState: UrunState = {
  loading: false,
  errorMessage: null,
  entities: [],
  entity: defaultValue,
  updating: false,
  totalItems: 0,
  updateSuccess: false,
  ureticis: [],
  satisUrunleri: [],
};

const apiUrl = 'api/uruns';

export const getEntities = createAsyncThunk(
  'urun/fetch_entity_list',
  async ({ page, size, sort }: IQueryParams) => {
    const requestUrl = `${apiUrl}?${sort ? `page=${page}&size=${size}&sort=${sort}&` : ''}cacheBuster=${Date.now()}`;
    return axios.get<IUrun[]>(requestUrl);
  },
  { serializeError: serializeAxiosError },
);

export const getEntity = createAsyncThunk('urun/fetch_entity', async (id: string | number) => axios.get<IUrun>(`${apiUrl}/${id}`), {
  serializeError: serializeAxiosError,
});

export const getUreticis = createAsyncThunk('urun/fetch_uretici_list', async () => axios.get<IUretici[]>('api/ureticis'), {
  serializeError: serializeAxiosError,
});

export const getAllUrunForStokGirisi = createAsyncThunk(
  'urun/fetch_stok_girisi_list',
  async () => axios.get<IUrun[]>(`${apiUrl}/stok-girisi`),
  { serializeError: serializeAxiosError },
);

export const getSatisUrunleri = createAsyncThunk('urun/fetch_satis_list', async () => axios.get<IUrun[]>(`${apiUrl}/satis`), {
  serializeError: serializeAxiosError,
});

export const createEntity = createAsyncThunk(
  'urun/create_entity',
  async (entity: IUrun) => {
    const result = await axios.post<IUrun>(apiUrl, cleanEntity(entity));
    return result;
  },
  { serializeError: serializeAxiosError },
);

export const updateEntity = createAsyncThunk(
  'urun/update_entity',
  async (entity: IUrun) => {
    const result = await axios.put<IUrun>(`${apiUrl}/${entity.id}`, cleanEntity(entity));
    return result;
  },
  { serializeError: serializeAxiosError },
);

export const deleteEntity = createAsyncThunk(
  'urun/delete_entity',
  async (id: string | number) => {
    const result = await axios.delete<IUrun>(`${apiUrl}/${id}`);
    return result;
  },
  { serializeError: serializeAxiosError },
);

export const UrunSlice = createEntitySlice({
  name: 'urun',
  initialState,
  extraReducers(builder) {
    builder
      .addCase(getEntity.fulfilled, (state, action) => {
        state.loading = false;
        state.entity = action.payload.data;
      })
      .addCase(getUreticis.fulfilled, (state, action) => {
        state.loading = false;
        state.ureticis = action.payload.data;
      })
      .addCase(getAllUrunForStokGirisi.fulfilled, (state, action) => {
        state.loading = false;
        state.satisUrunleri = action.payload.data;
      })
      .addCase(getSatisUrunleri.fulfilled, (state, action) => {
        state.loading = false;
        state.satisUrunleri = action.payload.data;
      })
      .addCase(deleteEntity.fulfilled, state => {
        state.updating = false;
        state.updateSuccess = true;
        state.entity = {};
      })
      .addMatcher(isFulfilled(getEntities), (state, action) => {
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
      .addMatcher(isPending(getEntities, getEntity, getUreticis, getAllUrunForStokGirisi, getSatisUrunleri), state => {
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

export const { reset } = UrunSlice.actions;

export default UrunSlice.reducer;
