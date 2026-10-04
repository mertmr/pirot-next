import React, { useEffect, useState } from 'react';
import Form from 'react-bootstrap/Form';
import Row from 'react-bootstrap/Row';
import Table from 'react-bootstrap/Table';
import { Link } from 'app/shared/routing/navigation';
import axios from 'axios';
import dayjs from 'dayjs';
import { JhiItemCount, JhiPagination } from 'react-jhipster';

import { APP_LOCAL_DATE_FORMAT } from 'app/config/constants';
import { ICiro } from 'app/shared/model/ciro.model';
import CustomTextFormat from 'app/shared/util/CustomTextFormat';
import { ITEMS_PER_PAGE } from 'app/shared/util/pagination.constants';
import { translate } from 'app/shared/jhipster/language';

const previousMonth = () => {
  const now = new Date();
  const fromDate =
    now.getMonth() === 0
      ? new Date(now.getFullYear() - 1, 11, now.getDate())
      : new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  return fromDate.toISOString().slice(0, 10);
};

const tomorrow = () => {
  const day = new Date();
  day.setDate(day.getDate() + 1);
  return day.toISOString().slice(0, 10);
};

export const CirosPage = () => {
  const [ciros, setCiros] = useState<ICiro[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [activePage, setActivePage] = useState(1);
  const [fromDate, setFromDate] = useState(previousMonth());
  const [toDate, setToDate] = useState(tomorrow());

  useEffect(() => {
    axios
      .get<ICiro[]>('api/reports/ciro', {
        params: {
          page: activePage - 1,
          size: ITEMS_PER_PAGE,
          sort: 'tarih,desc',
          fromDate,
          toDate,
        },
      })
      .then(response => {
        setCiros(response.data);
        setTotalItems(Number(response.headers['x-total-count'] ?? response.data.length));
      });
  }, [activePage, fromDate, toDate]);

  return (
    <div>
      <h2 id="ciros-page-heading">{translate('reports.ciro.title')}</h2>
      <Row className="g-3 mb-3">
        <Form.Group className="col-md-6">
          <Form.Label>{translate('reports.ciro.startDate')}</Form.Label>
          <Form.Control type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} />
        </Form.Group>
        <Form.Group className="col-md-6">
          <Form.Label>{translate('reports.ciro.endDate')}</Form.Label>
          <Form.Control type="date" value={toDate} onChange={event => setToDate(event.target.value)} />
        </Form.Group>
      </Row>
      {ciros.length > 0 ? (
        <>
          <Table striped responsive>
            <thead>
              <tr>
                <th>{translate('reports.common.columnDate')}</th>
                <th>{translate('reports.common.columnTotal')}</th>
                <th>{translate('reports.ciro.columnCard')}</th>
                <th>{translate('reports.ciro.columnCash')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ciros.map((ciro, index) => {
                const reportDate = ciro.tarih ? dayjs(ciro.tarih).format('YYYY-MM-DD') : '';
                return (
                  <tr key={`${reportDate}-${index}`}>
                    <td>
                      <CustomTextFormat value={ciro.tarih} type="date" format={APP_LOCAL_DATE_FORMAT} blankOnInvalid />
                    </td>
                    <td>{ciro.tutar}</td>
                    <td>{ciro.kartli}</td>
                    <td>{ciro.nakit}</td>
                    <td className="text-end">
                      <Link className="btn btn-info btn-sm" to={reportDate}>
                        Görüntüle
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <Row className="justify-content-center">
            <JhiItemCount page={activePage} total={totalItems} itemsPerPage={ITEMS_PER_PAGE} />
          </Row>
          <Row className="justify-content-center">
            <JhiPagination
              activePage={activePage}
              onSelect={page => setActivePage(page)}
              maxButtons={5}
              itemsPerPage={ITEMS_PER_PAGE}
              totalItems={totalItems}
            />
          </Row>
        </>
      ) : (
        <div className="alert alert-warning">{translate('reports.common.notFound')}</div>
      )}
    </div>
  );
};

export default CirosPage;
