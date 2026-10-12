import { IBorcAlacak } from 'app/shared/model/borc-alacak.model';
import { IKisiler } from 'app/shared/model/kisiler.model';
import { ISatisStokHareketleri } from 'app/shared/model/satis-stok-hareketleri.model';
import { IUser } from 'app/shared/model/user.model';

import { IDuzeltmeTalebi } from './nobet-duzeltme.model';

export interface ISatis {
  duzeltildi?: boolean;
  iptal?: boolean;
  nobetAcilisId?: number;
  duzeltme?: IDuzeltmeTalebi;
  id?: number;
  tarih?: string | null;
  toplamTutar?: number | string | null;
  ortagaSatis?: boolean | null;
  kartliSatis?: boolean | null;
  sonraOdeme?: boolean | null;
  odendi?: boolean | null;
  indirim?: number | string | null;
  stokHareketleriLists?: ISatisStokHareketleri[] | null;
  borcAlacak?: IBorcAlacak | null;
  user?: IUser | null;
  kisi?: IKisiler | null;
}

export interface ISatisLineRequest {
  urunId?: number;
  miktar?: number;
}

export interface ISatisRequest extends Omit<ISatis, 'stokHareketleriLists'> {
  stokHareketleriLists?: ISatisLineRequest[];
}

export const defaultValue: Readonly<ISatis> = {
  ortagaSatis: false,
  kartliSatis: false,
  sonraOdeme: false,
  odendi: false,
};
