import React, { useEffect, useMemo } from 'react';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Row from 'react-bootstrap/Row';
import { Translate, ValidatedField, ValidatedForm, translate } from 'react-jhipster';
import { Link, useNavigate, useParams } from 'app/shared/routing/navigation';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { useAppDispatch, useAppSelector } from 'app/config/store';
import { getEntities as getUruns } from 'app/entities/urun/urun.reducer';

import { createEntity, getEntity, reset, updateEntity } from './urun-fiyat-hesap.reducer';
import { isEntityFormReady } from 'app/shared/util/entity-form';

export const UrunFiyatHesapUpdate = () => {
  const dispatch = useAppDispatch();

  const navigate = useNavigate();

  const { id } = useParams<'id'>();
  const isNew = id === undefined;

  const uruns = useAppSelector(state => state.urun.entities);
  const urunFiyatHesapEntity = useAppSelector(state => state.urunFiyatHesap.entity);
  const formReady = isEntityFormReady(urunFiyatHesapEntity, id, isNew);
  const updating = useAppSelector(state => state.urunFiyatHesap.updating);
  const updateSuccess = useAppSelector(state => state.urunFiyatHesap.updateSuccess);

  const handleClose = () => {
    navigate(`/urun-fiyat-hesap${location.search}`);
  };

  useEffect(() => {
    if (isNew) {
      dispatch(reset());
    } else {
      dispatch(getEntity(id));
    }

    dispatch(getUruns({}));
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
    if (values.amortisman !== undefined && typeof values.amortisman !== 'number') {
      values.amortisman = Number(values.amortisman);
    }
    if (values.giderPusulaMustahsil !== undefined && typeof values.giderPusulaMustahsil !== 'number') {
      values.giderPusulaMustahsil = Number(values.giderPusulaMustahsil);
    }
    if (values.dukkanGider !== undefined && typeof values.dukkanGider !== 'number') {
      values.dukkanGider = Number(values.dukkanGider);
    }
    if (values.kooperatifCalisma !== undefined && typeof values.kooperatifCalisma !== 'number') {
      values.kooperatifCalisma = Number(values.kooperatifCalisma);
    }
    if (values.dayanisma !== undefined && typeof values.dayanisma !== 'number') {
      values.dayanisma = Number(values.dayanisma);
    }
    if (values.fire !== undefined && typeof values.fire !== 'number') {
      values.fire = Number(values.fire);
    }

    const entity = {
      ...urunFiyatHesapEntity,
      ...values,
      urun: uruns.find(it => it.id?.toString() === values.urun?.toString()),
    };

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
        ? {}
        : {
            ...urunFiyatHesapEntity,
            urun: urunFiyatHesapEntity?.urun?.id,
          },
    [isNew, urunFiyatHesapEntity],
  );

  return (
    <div>
      <Row className="justify-content-center">
        <Col md="8">
          <h2 id="koopApp.urunFiyatHesap.home.createOrEditLabel" data-cy="UrunFiyatHesapCreateUpdateHeading">
            <Translate contentKey="koopApp.urunFiyatHesap.home.createOrEditLabel">Create or edit a UrunFiyatHesap</Translate>
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
                  id="urun-fiyat-hesap-id"
                  label={translate('global.field.id')}
                  validate={{ required: true }}
                />
              )}
              <ValidatedField
                label={translate('koopApp.urunFiyatHesap.amortisman')}
                id="urun-fiyat-hesap-amortisman"
                name="amortisman"
                data-cy="amortisman"
                type="text"
              />
              <ValidatedField
                label={translate('koopApp.urunFiyatHesap.giderPusulaMustahsil')}
                id="urun-fiyat-hesap-giderPusulaMustahsil"
                name="giderPusulaMustahsil"
                data-cy="giderPusulaMustahsil"
                type="text"
              />
              <ValidatedField
                label={translate('koopApp.urunFiyatHesap.dukkanGider')}
                id="urun-fiyat-hesap-dukkanGider"
                name="dukkanGider"
                data-cy="dukkanGider"
                type="text"
              />
              <ValidatedField
                label={translate('koopApp.urunFiyatHesap.kooperatifCalisma')}
                id="urun-fiyat-hesap-kooperatifCalisma"
                name="kooperatifCalisma"
                data-cy="kooperatifCalisma"
                type="text"
              />
              <ValidatedField
                label={translate('koopApp.urunFiyatHesap.dayanisma')}
                id="urun-fiyat-hesap-dayanisma"
                name="dayanisma"
                data-cy="dayanisma"
                type="text"
              />
              <ValidatedField
                label={translate('koopApp.urunFiyatHesap.fire')}
                id="urun-fiyat-hesap-fire"
                name="fire"
                data-cy="fire"
                type="text"
              />
              <ValidatedField
                id="urun-fiyat-hesap-urun"
                name="urun"
                data-cy="urun"
                label={translate('koopApp.urunFiyatHesap.urun')}
                type="select"
              >
                <option value="" key="0" />
                {uruns
                  ? uruns.map(otherEntity => (
                      <option value={otherEntity.id} key={otherEntity.id}>
                        {otherEntity.id}
                      </option>
                    ))
                  : null}
              </ValidatedField>
              <Button as={Link as any} id="cancel-save" data-cy="entityCreateCancelButton" to="/urun-fiyat-hesap" replace variant="info">
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

export default UrunFiyatHesapUpdate;
