import { CorrectionRecord } from 'app/shared/financial/nobet-correction';
import React, { useEffect } from 'react';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Row from 'react-bootstrap/Row';
import Table from 'react-bootstrap/Table';
import { Translate } from 'react-jhipster';
import { Link, useParams } from 'app/shared/routing/navigation';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { APP_DATE_FORMAT } from 'app/config/constants';
import { useAppDispatch, useAppSelector } from 'app/config/store';
import CustomTextFormat from 'app/shared/util/CustomTextFormat';

import { getEntity } from './satis.reducer';

export const SatisDetail = () => {
  const dispatch = useAppDispatch();

  const { id } = useParams<'id'>();

  useEffect(() => {
    dispatch(getEntity(id!));
  }, [dispatch, id]);

  const satisEntity = useAppSelector(state => state.satis.entity);
  return (
    <Row>
      <Col md="8">
        <h2 data-cy="satisDetailsHeading">
          <Translate contentKey="koopApp.satis.detail.title">Satis</Translate> [<b>{satisEntity.id}</b>]
        </h2>
        {id && <CorrectionRecord type="satis" id={id} />}
        <dl className="jh-entity-details">
          <dt>
            <span id="tarih">
              <Translate contentKey="koopApp.satis.tarih">Tarih</Translate>
            </span>
          </dt>
          <dd>{satisEntity.tarih ? <CustomTextFormat value={satisEntity.tarih} type="date" format={APP_DATE_FORMAT} /> : null}</dd>
          <dt>
            <span id="toplamTutar">
              <Translate contentKey="koopApp.satis.toplamTutar">Toplam Tutar</Translate>
            </span>
          </dt>
          <dd>{satisEntity.toplamTutar}</dd>
          <dt>
            <span id="ortagaSatis">
              <Translate contentKey="koopApp.satis.ortagaSatis">Ortaga Satis</Translate>
            </span>
          </dt>
          <dd>{satisEntity.ortagaSatis ? 'true' : 'false'}</dd>
          <dt>
            <span id="kartliSatis">
              <Translate contentKey="koopApp.satis.kartliSatis">Kartli Satis</Translate>
            </span>
          </dt>
          <dd>{satisEntity.kartliSatis ? 'true' : 'false'}</dd>
          <dt>
            <Translate contentKey="koopApp.satis.user">User</Translate>
          </dt>
          <dd>{satisEntity.user ? satisEntity.user.login : ''}</dd>
          {satisEntity.borcAlacak?.notlar ? (
            <>
              <dt>
                <span id="odemeNotu">
                  <Translate contentKey="koopApp.satis.odemeNotu">Ödeme notu</Translate>
                </span>
              </dt>
              <dd>
                {satisEntity.borcAlacak.notlar} <Link to={`/borc-alacak/${satisEntity.borcAlacak.id}`}>#{satisEntity.borcAlacak.id}</Link>
              </dd>
            </>
          ) : null}
        </dl>
        <div className="table-responsive">
          {satisEntity.stokHareketleriLists && satisEntity.stokHareketleriLists.length > 0 ? (
            <Table responsive>
              <thead>
                <tr>
                  <th>
                    <Translate contentKey="koopApp.satisStokHareketleri.miktar">Miktar</Translate>
                  </th>
                  <th>
                    <Translate contentKey="koopApp.satisStokHareketleri.tutar">Tutar</Translate>
                  </th>
                  <th>
                    <Translate contentKey="koopApp.satisStokHareketleri.urun">Urun</Translate>
                  </th>
                </tr>
              </thead>
              <tbody>
                {satisEntity.stokHareketleriLists.map((satisStokHareketleri, i) => (
                  <tr key={`entity-${i}`}>
                    <td>{satisStokHareketleri.miktar}</td>
                    <td>{satisStokHareketleri.tutar} TL</td>
                    <td>{satisStokHareketleri.urun?.urunAdi}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <div className="alert alert-warning">
              <Translate contentKey="koopApp.satisStokHareketleri.home.notFound">No Satis Stok Hareketleris found</Translate>
            </div>
          )}
        </div>
        <Button as={Link as any} to="/satis" replace variant="info" data-cy="entityDetailsBackButton">
          <FontAwesomeIcon icon="arrow-left" />{' '}
          <span className="d-none d-md-inline">
            <Translate contentKey="entity.action.back">Back</Translate>
          </span>
        </Button>
        &nbsp;
        <Button as={Link as any} to={`/satis/${satisEntity.id}/edit`} replace variant="primary">
          <FontAwesomeIcon icon="pencil-alt" />{' '}
          <span className="d-none d-md-inline">
            <Translate contentKey="entity.action.edit">Edit</Translate>
          </span>
        </Button>
      </Col>
    </Row>
  );
};

export default SatisDetail;
