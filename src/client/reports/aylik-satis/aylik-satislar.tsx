import React, { useEffect, useState } from 'react';
import Form from 'react-bootstrap/Form';
import Table from 'react-bootstrap/Table';
import axios from 'axios';

import { IAylikSatislar } from 'app/shared/model/aylis-satislar.model';
import { IUrun } from 'app/shared/model/urun.model';
import { translate } from 'app/shared/jhipster/language';

export const AylikSatislarsPage = () => {
  const [urunler, setUrunler] = useState<IUrun[]>([]);
  const [aylikSatislar, setAylikSatislar] = useState<IAylikSatislar[]>([]);
  const [urunId, setUrunId] = useState('');

  useEffect(() => {
    axios.get<IUrun[]>('api/uruns/stok-girisi').then(response => setUrunler(response.data));
  }, []);

  const selectUrun = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setUrunId(value);
    if (!value) {
      setAylikSatislar([]);
      return;
    }
    const response = await axios.get<IAylikSatislar[]>(`api/satis-stok-hareketleris/getSatisRaporlari/${value}`);
    setAylikSatislar(response.data);
  };

  return (
    <div>
      <h2 id="aylikSatislars-page-heading">{translate('reports.aylikSales.title')}</h2>
      <Form.Group className="mb-3">
        <Form.Label>{translate('reports.aylikSales.productLabel')}</Form.Label>
        <Form.Select value={urunId} onChange={selectUrun}>
          <option value="">{translate('reports.common.selectProduct')}</option>
          {urunler.map(item => (
            <option key={item.id} value={item.id}>
              {item.urunAdi}
            </option>
          ))}
        </Form.Select>
      </Form.Group>
      {aylikSatislar.length > 0 ? (
        <Table striped responsive>
          <thead>
            <tr>
              <th>{translate('reports.common.columnSaleDate')}</th>
              <th>{translate('reports.common.columnSaleQuantity')}</th>
            </tr>
          </thead>
          <tbody>
            {aylikSatislar.map((aylikSatis, index) => (
              <tr key={`${aylikSatis.year}-${aylikSatis.month}-${index}`}>
                <td>
                  {aylikSatis.year} - {aylikSatis.month}
                </td>
                <td>{aylikSatis.miktar}</td>
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

export default AylikSatislarsPage;
