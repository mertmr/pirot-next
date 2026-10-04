import { createAsyncThunk, isFulfilled, isPending } from '@reduxjs/toolkit';
import axios from 'axios';

import { INobetHareketleri, defaultValue } from 'app/shared/model/nobet-hareketleri.model';
import { AcilisKapanis } from 'app/shared/model/enumerations/acilis-kapanis.model';
import { IGunSonuRaporu, defaultValueGunSonuRaporu } from 'app/shared/model/gun-sonu-raporu-model';
import { EntityState, IQueryParams, createEntitySlice, serializeAxiosError } from 'app/shared/reducers/reducer.utils';
import { cleanEntity } from 'app/shared/util/entity-utils';

type NobetHareketleriState = EntityState<INobetHareketleri> & {
  gunSonuRaporu: IGunSonuRaporu;
  workflow: INobetHareketleriWorkflow;
  workflowLoading: boolean;
  workflowError: string | null;
  saveError: string | null;
};

export interface INobetHareketleriWorkflow {
  nextAction?: keyof typeof AcilisKapanis | null;
  systemCash?: number | null;
  serverTime?: string | null;
  openingTarih?: string | null;
  openingFark?: number | null;
  activeOpening?: boolean;
  breakdown?: IExpectedCashBreakdown | null;
}

export interface IExpectedCashBreakdown {
  openingCash: number;
  satis: number;
  tahsilat: number;
  gider: number;
  virman: number;
  iade: number;
  diger: number;
  expectedCash: number;
  currentSystemCash: number;
  reconciled: boolean;
  movements: IExpectedCashMovement[];
}

export interface IExpectedCashMovement {
  id?: number | null;
  type: string;
  message?: string | null;
  delta: number;
  time?: string | null;
}

const initialState: NobetHareketleriState = {
  loading: false,
  errorMessage: null,
  entities: [],
  entity: defaultValue,
  updating: false,
  totalItems: 0,
  updateSuccess: false,
  gunSonuRaporu: defaultValueGunSonuRaporu,
  workflow: {},
  workflowLoading: false,
  workflowError: null,
  saveError: null,
};

const apiUrl = 'api/nobet-hareketleris';

export const getEntities = createAsyncThunk(
  'nobetHareketleri/fetch_entity_list',
  async ({ page, size, sort }: IQueryParams) => {
    const requestUrl = `${apiUrl}?${sort ? `page=${page}&size=${size}&sort=${sort}&` : ''}cacheBuster=${Date.now()}`;
    return axios.get<INobetHareketleri[]>(requestUrl);
  },
  { serializeError: serializeAxiosError },
);

export const getEntity = createAsyncThunk(
  'nobetHareketleri/fetch_entity',
  async (id: string | number) => {
    const requestUrl = `${apiUrl}/${id}`;
    return axios.get<INobetHareketleri>(requestUrl);
  },
  { serializeError: serializeAxiosError },
);

export const getGunSonuRaporu = createAsyncThunk(
  'nobetHareketleri/fetch_gun_sonu',
  async (reportDate: string) => axios.get<IGunSonuRaporu>(`api/reports/gun-sonu-raporu?reportDate=${encodeURIComponent(reportDate)}`),
  { serializeError: serializeAxiosError },
);

export const getWorkflow = createAsyncThunk(
  'nobetHareketleri/fetch_workflow',
  async () => axios.get<INobetHareketleriWorkflow>(`${apiUrl}/workflow`),
  { serializeError: serializeAxiosError },
);

export const createEntity = createAsyncThunk(
  'nobetHareketleri/create_entity',
  async (entity: INobetHareketleri) => {
    const result = await axios.post<INobetHareketleri>(apiUrl, cleanEntity(entity));
    return result;
  },
  { serializeError: serializeAxiosError },
);

export const updateEntity = createAsyncThunk(
  'nobetHareketleri/update_entity',
  async (entity: INobetHareketleri) => {
    const result = await axios.put<INobetHareketleri>(`${apiUrl}/${entity.id}`, cleanEntity(entity));
    return result;
  },
  { serializeError: serializeAxiosError },
);

export const deleteEntity = createAsyncThunk(
  'nobetHareketleri/delete_entity',
  async (id: string | number) => {
    const requestUrl = `${apiUrl}/${id}`;
    const result = await axios.delete<INobetHareketleri>(requestUrl);
    return result;
  },
  { serializeError: serializeAxiosError },
);

export const NobetHareketleriSlice = createEntitySlice({
  name: 'nobetHareketleri',
  initialState,
  extraReducers(builder) {
    builder
      .addCase(getEntity.fulfilled, (state, action) => {
        state.loading = false;
        state.entity = action.payload.data;
      })
      .addCase(getGunSonuRaporu.fulfilled, (state, action) => {
        state.loading = false;
        state.gunSonuRaporu = action.payload.data;
      })
      .addCase(getWorkflow.pending, state => {
        state.workflowLoading = true;
        state.workflowError = null;
      })
      .addCase(getWorkflow.fulfilled, (state, action) => {
        state.workflowLoading = false;
        state.workflow = action.payload.data;
      })
      .addCase(getWorkflow.rejected, (state, action) => {
        state.workflowLoading = false;
        state.workflowError = action.error.message ?? 'Nöbet durumu alınamadı';
      })
      .addCase(createEntity.rejected, (state, action) => {
        state.saveError = action.error.message ?? 'Nöbet kaydedilemedi';
      })
      .addCase(updateEntity.rejected, (state, action) => {
        state.saveError = action.error.message ?? 'Nöbet güncellenemedi';
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
        state.saveError = null;
      })
      .addMatcher(isPending(getEntities, getEntity, getGunSonuRaporu), state => {
        state.errorMessage = null;
        state.updateSuccess = false;
        state.loading = true;
      })
      .addMatcher(isPending(createEntity, updateEntity, deleteEntity), state => {
        state.errorMessage = null;
        state.updateSuccess = false;
        state.updating = true;
        state.saveError = null;
      });
  },
});

export const { reset } = NobetHareketleriSlice.actions;

export default NobetHareketleriSlice.reducer;
