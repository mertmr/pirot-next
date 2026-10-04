import React, { useEffect, useState } from 'react';
import Form from 'react-bootstrap/Form';
import Table from 'react-bootstrap/Table';
import axios from 'axios';
import dayjs from 'dayjs';

import { APP_DATE_FORMAT } from 'app/config/constants';
import { IStokGirisiUrun } from 'app/shared/model/stok-girisi-urun.model';
import { ITukenme, defaultValue as defaultTukenme } from 'app/shared/model/tukenme.model';
import { IUrun } from 'app/shared/model/urun.model';
import CustomTextFormat from 'app/shared/util/CustomTextFormat';
import { translate } from 'app/shared/jhipster/language';

export const TukenmePage = () => {
  const [urunler, setUrunler] = useState<IUrun[]>([]);
  const [stokGirisleri, setStokGirisleri] = useState<IStokGirisiUrun[]>([]);
  const [urun, setUrun] = useState<IUrun>();
  const [stokGirisi, setStokGirisi] = useState<IStokGirisiUrun>();
  const [tukenme, setTukenme] = useState<ITukenme>(defaultTukenme);

  useEffect(() => {
    axios.get<IUrun[]>('api/uruns/stok-girisi').then(response => setUrunler(response.data));
  }, []);

  const selectUrun = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = urunler.find(item => String(item.id) === event.target.value);
    setUrun(selected);
    setStokGirisi(undefined);
    setTukenme(defaultTukenme);
    if (!selected?.id) {
      setStokGirisleri([]);
      return;
    }
    const response = await axios.get<IStokGirisiUrun[]>(`api/findOnlyStokGirisiByUrun?id=${selected.id}`);
    setStokGirisleri(response.data);
  };

  const selectStokGirisi = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = stokGirisleri.find(item => String(item.stokGirisiId) === event.target.value);
    setStokGirisi(selected);
    if (!selected?.stokGirisiTarihi || !urun?.id) {
      setTukenme(defaultTukenme);
      return;
    }
    const stokGirisiDate = dayjs(selected.stokGirisiTarihi).format('YYYY-MM-DD');
    const response = await axios.get<ITukenme>('api/reports/urunTukenmeHizi', {
      params: { stokGirisiDate, urunId: urun.id },
    });
    setTukenme(response.data);
  };

  const fireOrani = stokGirisi?.miktar ? (((tukenme.urunFire ?? 0) / stokGirisi.miktar) * 100).toFixed(2) : '0.00';

  return (
    <div>
      <h2 id="tukenme-page-heading">{translate('reports.tukenme.title')}</h2>
      <Form.Group className="mb-3">
        <Form.Label>{translate('reports.tukenme.productLabel')}</Form.Label>
        <Form.Select value={urun?.id ?? ''} onChange={selectUrun}>
          <option value="">{translate('reports.common.selectProduct')}</option>
          {urunler.map(item => (
            <option key={item.id} value={item.id}>
              {item.urunAdi}
            </option>
          ))}
        </Form.Select>
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label>{translate('reports.tukenme.stockEntryLabel')}</Form.Label>
        <Form.Select value={stokGirisi?.stokGirisiId ?? ''} onChange={selectStokGirisi} disabled={!urun}>
          <option value="">{translate('reports.tukenme.selectStockEntry')}</option>
          {stokGirisleri.map(item => (
            <option key={item.stokGirisiId} value={item.stokGirisiId}>
              {item.stokGirisAciklamasi}
            </option>
          ))}
        </Form.Select>
      </Form.Group>
      <div className="mb-3">
        <div>{translate('reports.tukenme.monthlyRate', { rate: tukenme.aylikTukenmeHizi ?? 0 })}</div>
        <div>{translate('reports.tukenme.weeklyRate', { rate: tukenme.haftalikTukenmeHizi ?? 0 })}</div>
        <div>
          Bu Periyotta Girilen Fire: {tukenme.urunFire ?? 0} {urun?.birim ?? ''}
        </div>
        <div>{translate('reports.tukenme.wasteRatio', { ratio: fireOrani })}</div>
        <div>{translate('reports.tukenme.dataSpan', { days: tukenme.raporVeriOlcekSuresi ?? 0 })}</div>
      </div>
      {tukenme.stokGunluguList?.length ? (
        <Table striped responsive>
          <thead>
            <tr>
              <th>{translate('reports.common.columnSaleDate')}</th>
              <th>{translate('reports.common.columnSaleQuantity')}</th>
            </tr>
          </thead>
          <tbody>
            {tukenme.stokGunluguList.map((stokGunlugu, index) => (
              <tr key={stokGunlugu.id ?? index}>
                <td>
                  <CustomTextFormat type="date" value={stokGunlugu.satis?.tarih} format={APP_DATE_FORMAT} blankOnInvalid />
                </td>
                <td>{stokGunlugu.miktar}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <div className="alert alert-warning">{translate('reports.common.notFound')}</div>
      )}
    </div>
  );
};

export default TukenmePage;
