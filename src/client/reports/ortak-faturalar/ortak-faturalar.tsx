import React, { useEffect, useState } from 'react';
import Form from 'react-bootstrap/Form';
import Table from 'react-bootstrap/Table';
import { Link } from 'app/shared/routing/navigation';
import axios from 'axios';
import { Translate } from 'react-jhipster';

import { APP_DATE_FORMAT } from 'app/config/constants';
import { IKisiler } from 'app/shared/model/kisiler.model';
import { IReportDates } from 'app/shared/model/ortakfatura/report-dates.model';
import CustomTextFormat from 'app/shared/util/CustomTextFormat';
import { translate } from 'app/shared/jhipster/language';

export const OrtakFaturalarPage = () => {
  const [reportDateList, setReportDateList] = useState<IReportDates[]>([]);
  const [reportDate, setReportDate] = useState('');
  const [ortakFaturaKisiList, setOrtakFaturaKisiList] = useState<IKisiler[]>([]);

  useEffect(() => {
    axios.get<IReportDates[]>('api/reports/report-date-list').then(response => setReportDateList(response.data));
  }, []);

  const changeReportDate = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setReportDate(value);
    if (!value) {
      setOrtakFaturaKisiList([]);
      return;
    }
    const response = await axios.get<IKisiler[]>('api/reports/ortak-fatura-kisi-list', { params: { reportDate: value } });
    setOrtakFaturaKisiList(response.data);
  };

  return (
    <div>
      <h2 id="OrtakFaturalar-page-heading">{translate('reports.ortakFaturalar.title')}</h2>
      <Form.Group className="mb-3 col-12 col-md-4">
        <Form.Label>{translate('reports.ortakFaturalar.dateLabel')}</Form.Label>
        <Form.Select value={reportDate} onChange={changeReportDate}>
          <option value="">{translate('reports.common.selectDate')}</option>
          {reportDateList.map(item => (
            <option key={item.reportDate} value={item.reportDate}>
              {item.reportDate}
            </option>
          ))}
        </Form.Select>
      </Form.Group>
      {ortakFaturaKisiList.length > 0 ? (
        <Table responsive>
          <thead>
            <tr>
              <th>
                <Translate contentKey="global.field.id">ID</Translate>
              </th>
              <th>
                <Translate contentKey="koopApp.kisiler.kisiAdi">Kişi Adı</Translate>
              </th>
              <th>
                <Translate contentKey="koopApp.kisiler.notlar">Notlar</Translate>
              </th>
              <th>
                <Translate contentKey="koopApp.kisiler.tarih">Tarih</Translate>
              </th>
            </tr>
          </thead>
          <tbody>
            {ortakFaturaKisiList.map((kisi, index) => (
              <tr key={kisi.id ?? index}>
                <td>
                  <Link to={`${kisi.id}_${reportDate}`}>{kisi.id}</Link>
                </td>
                <td>{kisi.kisiAdi}</td>
                <td>{kisi.notlar}</td>
                <td>
                  <CustomTextFormat type="date" value={kisi.tarih} format={APP_DATE_FORMAT} blankOnInvalid />
                </td>
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

export default OrtakFaturalarPage;
