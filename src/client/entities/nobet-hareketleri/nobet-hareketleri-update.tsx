import Decimal from 'decimal.js';
import React, { useEffect, useMemo, useState } from 'react';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import Col from 'react-bootstrap/Col';
import Form from 'react-bootstrap/Form';
import Row from 'react-bootstrap/Row';
import Table from 'react-bootstrap/Table';
import { Translate, translate } from 'react-jhipster';
import { Link, useLocation, useNavigate, useParams } from 'app/shared/routing/navigation';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { useAppDispatch, useAppSelector } from 'app/config/store';
import { AcilisKapanis } from 'app/shared/model/enumerations/acilis-kapanis.model';

import { createEntity, getEntity, getWorkflow, reset, updateEntity } from './nobet-hareketleri.reducer';
import { isEntityFormReady } from 'app/shared/util/entity-form';

const DENOMINATIONS: readonly { cents: number; label: string }[] = [
  { cents: 20000, label: '200' },
  { cents: 10000, label: '100' },
  { cents: 5000, label: '50' },
  { cents: 2000, label: '20' },
  { cents: 1000, label: '10' },
  { cents: 500, label: '5' },
  { cents: 100, label: '1' },
  { cents: 50, label: '0.50' },
  { cents: 25, label: '0.25' },
  { cents: 10, label: '0.10' },
  { cents: 5, label: '0.05' },
];

const toMoney = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2));

const formatMoney = (value: number | string | null | undefined) =>
  value === null || value === undefined ? '—' : new Decimal(value).toFixed(2);

const formatSignedMoney = (value: number | string | null | undefined) => {
  if (value === null || value === undefined) {
    return '—';
  }
  return `${new Decimal(value).isPositive() ? '+' : ''}${new Decimal(value).toFixed(2)}`;
};

const formatMovementTime = (value: string | null | undefined) => (value ? new Date(value).toLocaleString() : '—');

const countTotal = (counts: Record<string, string>) =>
  DENOMINATIONS.reduce((total, denomination) => {
    const count = Number.parseInt(counts[denomination.label] ?? '', 10);
    return Number.isInteger(count) && count > 0 ? total + count * denomination.cents : total;
  }, 0);

export const NobetHareketleriUpdate = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<'id'>();
  const isNew = id === undefined;

  const nobetHareketleriEntity = useAppSelector(state => state.nobetHareketleri.entity);
  const formReady = isEntityFormReady(nobetHareketleriEntity, id, isNew);
  const updating = useAppSelector(state => state.nobetHareketleri.updating);
  const updateSuccess = useAppSelector(state => state.nobetHareketleri.updateSuccess);
  const saveError = useAppSelector(state => state.nobetHareketleri.saveError);
  const workflow = useAppSelector(state => state.nobetHareketleri.workflow);
  const workflowLoading = useAppSelector(state => state.nobetHareketleri.workflowLoading);
  const workflowError = useAppSelector(state => state.nobetHareketleri.workflowError);

  const [counts, setCounts] = useState<Record<string, string>>({});
  const [countedCents, setCountedCents] = useState<number | null>(null);
  const [notlar, setNotlar] = useState('');
  const [editNotlar, setEditNotlar] = useState('');

  useEffect(() => {
    if (isNew) {
      dispatch(reset());
      dispatch(getWorkflow());
    } else {
      dispatch(getEntity(id));
    }
  }, [dispatch, id, isNew]);

  useEffect(() => {
    if (!isNew && nobetHareketleriEntity.id !== undefined) {
      setEditNotlar(nobetHareketleriEntity.notlar ?? '');
    }
  }, [isNew, nobetHareketleriEntity.id, nobetHareketleriEntity.notlar]);

  useEffect(() => {
    if (updateSuccess) {
      navigate(`/nobet-hareketleri${location.search}`);
    }
  }, [location.search, navigate, updateSuccess]);

  const totalCents = useMemo(() => countTotal(counts), [counts]);
  const isClosing = workflow.nextAction === AcilisKapanis.KAPANIS;
  const expectedCash = isClosing && workflow.breakdown ? workflow.breakdown.expectedCash : workflow.systemCash;
  const expectedCashCents = expectedCash === null || expectedCash === undefined ? null : Math.round(expectedCash * 100);
  const differenceCents = countedCents === null || expectedCashCents === null ? null : countedCents - expectedCashCents;
  const explanationRequired = differenceCents !== null && differenceCents !== 0;

  const handleCountChange = (label: string) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    const nextCounts = { ...counts, [label]: nextValue };
    setCounts(nextCounts);
    setCountedCents(countTotal(nextCounts));
  };

  const saveNewShift = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (countedCents === null || updating || workflow.nextAction == null || (explanationRequired && !notlar.trim())) {
      return;
    }
    dispatch(
      createEntity({
        kasa: countedCents / 100,
        notlar: notlar.trim() || null,
        acilisKapanis: workflow.nextAction,
      }),
    );
  };

  const saveEdit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (nobetHareketleriEntity.id === undefined || updating) {
      return;
    }
    dispatch(updateEntity({ id: nobetHareketleriEntity.id, notlar: editNotlar.trim() || null }));
  };

  const renderBackButton = () => (
    <Button as={Link as any} id="cancel-save" data-cy="entityCreateCancelButton" to="/nobet-hareketleri" replace variant="info">
      <FontAwesomeIcon icon="arrow-left" />
      &nbsp;
      <span className="d-none d-md-inline">
        <Translate contentKey="entity.action.back">Back</Translate>
      </span>
    </Button>
  );

  if (!isNew) {
    return (
      <div>
        <Row className="justify-content-center">
          <Col md="8">
            <h2 id="koopApp.nobetHareketleri.home.createOrEditLabel" data-cy="NobetHareketleriCreateUpdateHeading">
              <Translate contentKey="koopApp.nobetHareketleri.editTitle">Nöbet kaydını düzenle</Translate>
            </h2>
          </Col>
        </Row>
        <Row className="justify-content-center">
          <Col md="8">
            {!formReady ? (
              <p role="status">
                <Translate contentKey="koopApp.nobetHareketleri.loading">Yükleniyor…</Translate>
              </p>
            ) : (
              <Form onSubmit={saveEdit}>
                {saveError ? (
                  <Alert variant="danger" role="alert">
                    {saveError}
                  </Alert>
                ) : null}
                <Card className="mb-3">
                  <Card.Body>
                    <Card.Title>
                      <Translate contentKey="koopApp.nobetHareketleri.historicalValues">Tarihsel değerler</Translate>
                    </Card.Title>
                    <Table responsive size="sm" className="mb-0">
                      <tbody>
                        <tr>
                          <th scope="row">
                            <Translate contentKey="koopApp.nobetHareketleri.kasa">Sayılan Kasa</Translate>
                          </th>
                          <td>{formatMoney(nobetHareketleriEntity.kasa)}</td>
                        </tr>
                        <tr>
                          <th scope="row">
                            <Translate contentKey="koopApp.nobetHareketleri.pirot">Sistem Kasası</Translate>
                          </th>
                          <td>{formatMoney(nobetHareketleriEntity.pirot)}</td>
                        </tr>
                        <tr>
                          <th scope="row">
                            <Translate contentKey="koopApp.nobetHareketleri.fark">Fark</Translate>
                          </th>
                          <td>{formatMoney(nobetHareketleriEntity.fark)}</td>
                        </tr>
                        <tr>
                          <th scope="row">
                            <Translate contentKey="koopApp.nobetHareketleri.farkDenge">Nöbet Farkı</Translate>
                          </th>
                          <td>{formatMoney(nobetHareketleriEntity.farkDenge)}</td>
                        </tr>
                      </tbody>
                    </Table>
                  </Card.Body>
                </Card>
                <Form.Group className="mb-3" controlId="nobet-hareketleri-edit-notlar">
                  <Form.Label>
                    <Translate contentKey="koopApp.nobetHareketleri.explanation">Fark açıklaması / not</Translate>
                  </Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    data-cy="notlar"
                    value={editNotlar}
                    onChange={event => setEditNotlar(event.target.value)}
                  />
                </Form.Group>
                {renderBackButton()}
                &nbsp;
                <Button variant="primary" id="save-entity" data-cy="entityCreateSaveButton" type="submit" disabled={updating}>
                  <FontAwesomeIcon icon="save" />
                  &nbsp;
                  <Translate contentKey="entity.action.save">Save</Translate>
                </Button>
              </Form>
            )}
          </Col>
        </Row>
      </div>
    );
  }

  if (workflowLoading) {
    return (
      <div className="text-center" role="status">
        <Translate contentKey="koopApp.nobetHareketleri.loading">Yükleniyor…</Translate>
      </div>
    );
  }

  if (workflowError || workflow.nextAction == null) {
    return (
      <Alert variant="danger" role="alert">
        <Translate contentKey="koopApp.nobetHareketleri.workflowError">Nöbet durumu alınamadı.</Translate>
        <Button className="ms-2" variant="outline-danger" onClick={() => dispatch(getWorkflow())}>
          <Translate contentKey="koopApp.nobetHareketleri.retry">Tekrar dene</Translate>
        </Button>
      </Alert>
    );
  }

  const submitDisabled = updating || countedCents === null || (explanationRequired && !notlar.trim());

  return (
    <div>
      <Row className="justify-content-center">
        <Col md="10" lg="8">
          <h2 id="koopApp.nobetHareketleri.home.createOrEditLabel" data-cy="NobetHareketleriCreateUpdateHeading">
            <Translate contentKey={isClosing ? 'koopApp.nobetHareketleri.closeTitle' : 'koopApp.nobetHareketleri.startTitle'}>
              {isClosing ? 'Nöbeti Kapat' : 'Nöbeti Başlat'}
            </Translate>
          </h2>
          <p className="text-muted">
            <Translate contentKey={isClosing ? 'koopApp.nobetHareketleri.closeDescription' : 'koopApp.nobetHareketleri.startDescription'}>
              Kasadaki parayı kupürleriyle sayın.
            </Translate>
          </p>
        </Col>
      </Row>
      <Row className="justify-content-center">
        <Col md="10" lg="8">
          {saveError ? (
            <Alert variant="danger" role="alert">
              {saveError}
            </Alert>
          ) : null}
          <Form onSubmit={saveNewShift}>
            {!isClosing ? (
              <Card className="mb-3" data-cy="expected-cash-summary">
                <Card.Body>
                  <Card.Title>
                    <Translate contentKey="koopApp.nobetHareketleri.expectedCashBreakdown.compactTitle">Beklenen sistem kasası</Translate>
                  </Card.Title>
                  <p className="display-6 mb-0" data-cy="expected-cash">
                    {formatMoney(workflow.systemCash)} ₺
                  </p>
                </Card.Body>
              </Card>
            ) : null}
            {isClosing && workflow.breakdown ? (
              <Card className="mb-3" data-cy="expected-cash-breakdown">
                <Card.Body>
                  <Card.Title>
                    <Translate contentKey="koopApp.nobetHareketleri.expectedCashBreakdown.title">Beklenen kasa dökümü</Translate>
                  </Card.Title>
                  <Table responsive size="sm" className="mb-3">
                    <tbody>
                      <tr>
                        <th scope="row">
                          <Translate contentKey="koopApp.nobetHareketleri.expectedCashBreakdown.openingCash">
                            Açılış sistem kasası
                          </Translate>
                        </th>
                        <td className="text-end" data-cy="breakdown-openingCash">
                          {formatMoney(workflow.breakdown.openingCash)} ₺
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">
                          <Translate contentKey="koopApp.nobetHareketleri.expectedCashBreakdown.satis">Nakit satışlar</Translate>
                        </th>
                        <td className="text-end" data-cy="breakdown-satis">
                          {formatSignedMoney(workflow.breakdown.satis)} ₺
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">
                          <Translate contentKey="koopApp.nobetHareketleri.expectedCashBreakdown.tahsilat">Nakit tahsilatlar</Translate>
                        </th>
                        <td className="text-end" data-cy="breakdown-tahsilat">
                          {formatSignedMoney(workflow.breakdown.tahsilat)} ₺
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">
                          <Translate contentKey="koopApp.nobetHareketleri.expectedCashBreakdown.gider">Giderler</Translate>
                        </th>
                        <td className="text-end" data-cy="breakdown-gider">
                          {formatSignedMoney(workflow.breakdown.gider)} ₺
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">
                          <Translate contentKey="koopApp.nobetHareketleri.expectedCashBreakdown.virman">Virmanlar</Translate>
                        </th>
                        <td className="text-end" data-cy="breakdown-virman">
                          {formatSignedMoney(workflow.breakdown.virman)} ₺
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">
                          <Translate contentKey="koopApp.nobetHareketleri.expectedCashBreakdown.iade">İadeler</Translate>
                        </th>
                        <td className="text-end" data-cy="breakdown-iade">
                          {formatSignedMoney(workflow.breakdown.iade)} ₺
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">
                          <Translate contentKey="koopApp.nobetHareketleri.expectedCashBreakdown.diger">Diğer / düzeltme</Translate>
                        </th>
                        <td className="text-end" data-cy="breakdown-diger">
                          {formatSignedMoney(workflow.breakdown.diger)} ₺
                        </td>
                      </tr>
                      <tr className="fw-bold">
                        <th scope="row">
                          <Translate contentKey="koopApp.nobetHareketleri.expectedCashBreakdown.expectedCash">Beklenen kasa</Translate>
                        </th>
                        <td className="text-end" data-cy="breakdown-expectedCash">
                          {formatMoney(workflow.breakdown.expectedCash)} ₺
                        </td>
                      </tr>
                    </tbody>
                  </Table>
                  {!workflow.breakdown.reconciled ? (
                    <Alert variant="warning" role="status">
                      <Translate contentKey="koopApp.nobetHareketleri.expectedCashBreakdown.unreconciled">
                        Bazı geçmiş kasa hareketleri kümülatif bakiyeden tamamlandı; ayrıntılar yaklaşık olabilir.
                      </Translate>
                    </Alert>
                  ) : null}
                  <details data-cy="movement-details">
                    <summary>
                      <Translate contentKey="koopApp.nobetHareketleri.expectedCashBreakdown.details">Hareket ayrıntıları</Translate>
                    </summary>
                    {workflow.breakdown.movements.length > 0 ? (
                      <Table responsive size="sm" className="mt-2 mb-0">
                        <thead>
                          <tr>
                            <th scope="col">
                              <Translate contentKey="koopApp.nobetHareketleri.expectedCashBreakdown.time">Zaman</Translate>
                            </th>
                            <th scope="col">
                              <Translate contentKey="koopApp.nobetHareketleri.expectedCashBreakdown.type">Tür</Translate>
                            </th>
                            <th scope="col">
                              <Translate contentKey="koopApp.nobetHareketleri.expectedCashBreakdown.message">Açıklama</Translate>
                            </th>
                            <th scope="col" className="text-end">
                              <Translate contentKey="koopApp.nobetHareketleri.expectedCashBreakdown.delta">Değişim</Translate>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {workflow.breakdown.movements.map((movement, index) => (
                            <tr key={movement.id ?? `${movement.time ?? 'movement'}-${index}`}>
                              <td>{formatMovementTime(movement.time)}</td>
                              <td>
                                <Translate contentKey={`koopApp.nobetHareketleri.expectedCashBreakdown.types.${movement.type}`}>
                                  {movement.type}
                                </Translate>
                              </td>
                              <td>{movement.message || '—'}</td>
                              <td className="text-end">{formatSignedMoney(movement.delta)} ₺</td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    ) : (
                      <p className="text-muted mt-2 mb-0">
                        <Translate contentKey="koopApp.nobetHareketleri.expectedCashBreakdown.noMovements">
                          Bu aralıkta kasa hareketi yok.
                        </Translate>
                      </p>
                    )}
                  </details>
                </Card.Body>
              </Card>
            ) : null}
            <Card className="mb-3">
              <Card.Body>
                <Card.Title>
                  <Translate contentKey="koopApp.nobetHareketleri.cashCount">Kasa sayımı</Translate>
                </Card.Title>
                <Row xs={2} sm={3} md={4} className="g-2">
                  {DENOMINATIONS.map(denomination => (
                    <Col key={denomination.label}>
                      <Form.Group controlId={`money-${denomination.label.replace('.', '-')}`}>
                        <Form.Label>{denomination.label} ₺</Form.Label>
                        <Form.Control
                          data-cy={`money-${denomination.label}`}
                          name={`money-${denomination.label}`}
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          value={counts[denomination.label] ?? ''}
                          onChange={handleCountChange(denomination.label)}
                        />
                      </Form.Group>
                    </Col>
                  ))}
                </Row>
              </Card.Body>
            </Card>
            <Card className="mb-3">
              <Card.Body>
                <Card.Title>
                  <Translate contentKey="koopApp.nobetHareketleri.summary">Özet</Translate>
                </Card.Title>
                <Row xs={1} sm={3} className="g-2">
                  <Col>
                    <Form.Label htmlFor="nobet-hareketleri-kasa">
                      <Translate contentKey="koopApp.nobetHareketleri.kasa">Sayılan Kasa</Translate>
                    </Form.Label>
                    <Form.Control id="nobet-hareketleri-kasa" data-cy="kasa" value={toMoney(countedCents)} readOnly />
                  </Col>
                  <Col>
                    <Form.Label htmlFor="nobet-hareketleri-pirot">
                      <Translate contentKey="koopApp.nobetHareketleri.pirot">Sistem Kasası</Translate>
                    </Form.Label>
                    <Form.Control id="nobet-hareketleri-pirot" data-cy="pirot" value={formatMoney(expectedCash)} readOnly />
                  </Col>
                  <Col>
                    <Form.Label htmlFor="nobet-hareketleri-fark">
                      <Translate contentKey="koopApp.nobetHareketleri.fark">Fark</Translate>
                    </Form.Label>
                    <Form.Control
                      id="nobet-hareketleri-fark"
                      data-cy="fark"
                      value={differenceCents === null ? '' : toMoney(differenceCents)}
                      readOnly
                    />
                  </Col>
                </Row>
                {isClosing && workflow.openingTarih ? (
                  <p className="small text-muted mt-3 mb-0">
                    <Translate
                      contentKey="koopApp.nobetHareketleri.openingReference"
                      interpolate={{ fark: formatMoney(workflow.openingFark) }}
                    >
                      Açılış farkı
                    </Translate>
                  </p>
                ) : null}
              </Card.Body>
            </Card>
            <Form.Group className="mb-3" controlId="nobet-hareketleri-notlar">
              <Form.Label>
                <Translate contentKey="koopApp.nobetHareketleri.explanation">Fark açıklaması / not</Translate>
              </Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                data-cy="notlar"
                value={notlar}
                required={explanationRequired}
                isInvalid={explanationRequired && !notlar.trim()}
                placeholder={translate('koopApp.nobetHareketleri.explanationPlaceholder')}
                onChange={event => setNotlar(event.target.value)}
              />
              {explanationRequired ? (
                <Form.Control.Feedback type="invalid">
                  <Translate contentKey="koopApp.nobetHareketleri.explanationRequired">Fark varsa açıklama girin.</Translate>
                </Form.Control.Feedback>
              ) : null}
            </Form.Group>
            {renderBackButton()}
            &nbsp;
            <Button variant="primary" id="save-entity" data-cy="entityCreateSaveButton" type="submit" disabled={submitDisabled}>
              <FontAwesomeIcon icon={isClosing ? 'lock' : 'play'} />
              &nbsp;
              <Translate contentKey={isClosing ? 'koopApp.nobetHareketleri.closeAction' : 'koopApp.nobetHareketleri.startAction'}>
                {isClosing ? 'Nöbeti Kapat' : 'Nöbeti Başlat'}
              </Translate>
            </Button>
          </Form>
          <output className="visually-hidden" data-cy="cash-count-total">
            {toMoney(totalCents)}
          </output>
        </Col>
      </Row>
    </div>
  );
};

export default NobetHareketleriUpdate;
