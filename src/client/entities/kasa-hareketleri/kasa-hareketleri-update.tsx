import React, { useEffect, useMemo } from 'react';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Row from 'react-bootstrap/Row';
import { Translate, ValidatedField, ValidatedForm, translate } from 'react-jhipster';
import { Link, useNavigate, useParams } from 'app/shared/routing/navigation';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { useAppDispatch, useAppSelector } from 'app/config/store';
import { convertDateTimeFromServer, convertDateTimeToServer, displayDefaultDateTime } from 'app/shared/util/date-utils';

import { createEntity, getEntity, reset, updateEntity } from './kasa-hareketleri.reducer';
import { isEntityFormReady } from 'app/shared/util/entity-form';

export const KasaHareketleriUpdate = () => {
  const dispatch = useAppDispatch();

  const navigate = useNavigate();

  const { id } = useParams<'id'>();
  const isNew = id === undefined;

  const kasaHareketleriEntity = useAppSelector(state => state.kasaHareketleri.entity);
  const formReady = isEntityFormReady(kasaHareketleriEntity, id, isNew);
  const updating = useAppSelector(state => state.kasaHareketleri.updating);
  const updateSuccess = useAppSelector(state => state.kasaHareketleri.updateSuccess);

  const handleClose = () => {
    navigate(`/kasa-hareketleri${location.search}`);
  };

  useEffect(() => {
    if (isNew) {
      dispatch(reset());
    } else {
      dispatch(getEntity(id));
    }
  }, []);

  useEffect(() => {
    if (updateSuccess) {
      handleClose();
    }
  }, [updateSuccess]);

  const saveEntity = values => {
    if (values.id !== undefined && typeof values.id !== 'number') {
      values.id = Number(values.id);
    }
    values.tarih = convertDateTimeToServer(values.tarih);

    const entity = {
      ...kasaHareketleriEntity,
      ...values,
    };

    delete entity.degisimTutari;
    if (isNew) {
      dispatch(createEntity(entity));
    } else {
      dispatch(updateEntity(entity));
    }
  };

  // Memoized identity matters: ValidatedForm resets the form whenever the
  // defaultValues reference changes, so it must not be rebuilt on every render.
  const defaultValues = useMemo(
    () =>
      isNew
        ? {
            tarih: displayDefaultDateTime(),
          }
        : {
            ...kasaHareketleriEntity,
            tarih: convertDateTimeFromServer(kasaHareketleriEntity.tarih),
          },
    [isNew, kasaHareketleriEntity],
  );

  return (
    <div>
      <Row className="justify-content-center">
        <Col md="8">
          <h2 id="koopApp.kasaHareketleri.home.createOrEditLabel" data-cy="KasaHareketleriCreateUpdateHeading">
            <Translate contentKey="koopApp.kasaHareketleri.home.createOrEditLabel">Create or edit a KasaHareketleri</Translate>
          </h2>
        </Col>
      </Row>
      <Row className="justify-content-center">
        <Col md="8">
          {!formReady ? (
            <p>{translate('reports.common.loading')}</p>
          ) : (
            <ValidatedForm defaultValues={defaultValues} onSubmit={saveEntity}>
              {!isNew && (
                <ValidatedField
                  name="id"
                  required
                  readOnly
                  id="kasa-hareketleri-id"
                  label={translate('global.field.id')}
                  validate={{ required: true }}
                />
              )}
              <ValidatedField
                label={translate('koopApp.kasaHareketleri.kasaMiktar')}
                id="kasa-hareketleri-kasaMiktar"
                name="kasaMiktar"
                data-cy="kasaMiktar"
                type="text"
              />
              <ValidatedField
                label={translate('koopApp.kasaHareketleri.hareket')}
                id="kasa-hareketleri-hareket"
                name="hareket"
                data-cy="hareket"
                type="text"
              />
              <ValidatedField
                label={translate('koopApp.kasaHareketleri.tarih')}
                id="kasa-hareketleri-tarih"
                name="tarih"
                data-cy="tarih"
                type="datetime-local"
                placeholder="YYYY-MM-DD HH:mm"
              />
              <Button as={Link as any} id="cancel-save" data-cy="entityCreateCancelButton" to="/kasa-hareketleri" replace variant="info">
                <FontAwesomeIcon icon="arrow-left" />
                &nbsp;
                <span className="d-none d-md-inline">
                  <Translate contentKey="entity.action.back">Back</Translate>
                </span>
              </Button>
              &nbsp;
              <Button variant="primary" id="save-entity" data-cy="entityCreateSaveButton" type="submit" disabled={updating}>
                <FontAwesomeIcon icon="save" />
                &nbsp;
                <Translate contentKey="entity.action.save">Save</Translate>
              </Button>
            </ValidatedForm>
          )}
        </Col>
      </Row>
    </div>
  );
};

export default KasaHareketleriUpdate;
