import React, { useEffect, useState } from 'react';
import Table from 'react-bootstrap/Table';
import axios from 'axios';

import { IAylikSatislarMali, defaultValue } from 'app/shared/model/aylis-satislar-mali.model';
import { translate } from 'app/shared/jhipster/language';

export const AylikSatisMalilarsPage = () => {
  const [rapor, setRapor] = useState<IAylikSatislarMali>(defaultValue);

  useEffect(() => {
    axios.get<IAylikSatislarMali>('api/satis-stok-hareketleris/getMaliSatisRaporlari').then(response => setRapor(response.data));
  }, []);

  const tarihler = rapor.tarihListesi ?? [];
  const urunler = rapor.urunAdiListesi ?? [];
  const satislar = rapor.aylikSatisMap ?? {};

  return (
    <div>
      <h2 id="aylikSatisMalilars-page-heading">{translate('reports.aylikSalesCost.title')}</h2>
      {tarihler.length > 0 ? (
        <Table striped responsive>
          <thead>
            <tr>
              <th>{translate('reports.aylikSalesCost.columnProducts')}</th>
              {tarihler.map(tarih => (
                <th key={tarih}>{tarih.slice(0, 7)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {urunler.map(urun => (
              <tr key={urun}>
                <td>{urun}</td>
                {tarihler.map(tarih => {
                  const key = `${tarih.slice(0, 4)}.${tarih.slice(5, 7)}${urun}`;
                  return <td key={`${urun}-${tarih}`}>{satislar[key] ?? '-'}</td>;
                })}
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

export default AylikSatisMalilarsPage;
