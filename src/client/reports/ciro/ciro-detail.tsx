import React, { useEffect, useState } from 'react';
import Col from 'react-bootstrap/Col';
import Row from 'react-bootstrap/Row';
import Table from 'react-bootstrap/Table';
import { useParams } from 'app/shared/routing/navigation';
import axios from 'axios';

import { APP_LOCAL_DATE_FORMAT } from 'app/config/constants';
import { ICiro } from 'app/shared/model/ciro.model';
import CustomTextFormat from 'app/shared/util/CustomTextFormat';
import { translate } from 'app/shared/jhipster/language';

export const CiroDetail = () => {
  const { id } = useParams<'id'>();
  const [ciros, setCiros] = useState<ICiro[]>([]);

  useEffect(() => {
    if (id) {
      axios.get<ICiro[]>('api/reports/ciro/by-nobetci', { params: { fromDate: id } }).then(response => setCiros(response.data));
    }
  }, [id]);

  return (
    <Row>
      <Col md="8">
        <h2>{translate('reports.ciro.detailTitle')}</h2>
        {ciros.length > 0 ? (
          <Table striped responsive>
            <thead>
              <tr>
                <th>{translate('reports.ciro.columnStaff')}</th>
                <th>{translate('reports.common.columnDate')}</th>
                <th>{translate('reports.common.columnTotal')}</th>
                <th>{translate('reports.ciro.columnCard')}</th>
                <th>{translate('reports.ciro.columnCash')}</th>
              </tr>
            </thead>
            <tbody>
              {ciros.map((ciro, index) => (
                <tr key={`${ciro.nobetci ?? 'ciro'}-${index}`}>
                  <td>{ciro.nobetci}</td>
                  <td>
                    <CustomTextFormat value={ciro.tarih} type="date" format={APP_LOCAL_DATE_FORMAT} blankOnInvalid />
                  </td>
                  <td>{ciro.tutar}</td>
                  <td>{ciro.kartli}</td>
                  <td>{ciro.nakit}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="alert alert-warning">{translate('reports.common.notFound')}</div>
        )}
      </Col>
    </Row>
  );
};

export default CiroDetail;
